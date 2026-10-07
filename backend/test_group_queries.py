"""Bounded DynamoDB reads must paginate and never silently omit members."""
import unittest
import re
from pathlib import Path
from unittest.mock import Mock, patch

from test_auth import lambda_app as app, FakeGroupTable


class GroupQueryTests(unittest.TestCase):
    def test_commissioner_api_routes_use_the_existing_jwt_authorizer(self):
        source = (Path(__file__).parents[1] / "terraform/modules/app/main.tf").read_text()
        routes = dict(re.findall(r'resource "aws_apigatewayv2_route" "([^"]+)" \{\n(.*?)\n\}', source, re.S))
        for name, route in (("group_member_remove", "DELETE /api/groups/{groupId}/members/{userId}"),
                            ("group_invite_regenerate", "POST /api/groups/{groupId}/invite"),
                            ("group_commissioner_transfer", "POST /api/groups/{groupId}/commissioner")):
            self.assertIn(f'"{route}"', routes[name])
            self.assertIn('authorization_type = "JWT"', routes[name])
            self.assertIn('authorizer_id      = aws_apigatewayv2_authorizer.cognito.id', routes[name])
        self.assertNotIn('group_invite_revoke', routes)
        self.assertNotIn('DELETE /api/groups/{groupId}/invite', source)

    def test_queries_follow_every_page_with_the_same_index_condition(self):
        table = Mock()
        table.query.side_effect = [{"Items": [{"userId": "a"}], "LastEvaluatedKey": {"groupKey": "a"}},
                                   {"Items": [] , "LastEvaluatedKey": {"groupKey": "b"}},
                                   {"Items": [{"userId": "b"}]}]
        result = app.query_all(table, IndexName="user-groups", KeyConditionExpression="userId = :user",
                               ExpressionAttributeValues={":user": "a"})
        self.assertEqual([item["userId"] for item in result], ["a", "b"])
        self.assertEqual(table.query.call_args_list[1].kwargs["ExclusiveStartKey"], {"groupKey": "a"})
        self.assertTrue(all(call.kwargs["IndexName"] == "user-groups" for call in table.query.call_args_list))

    def test_batches_deduplicate_chunk_retry_unprocessed_keys_and_read_consistently(self):
        table = Mock()
        table.name = "groups"
        calls = []
        def read(*, RequestItems):
            request = RequestItems["groups"]
            calls.append(request)
            keys = request["Keys"]
            if len(calls) == 1:
                return {"Responses": {"groups": keys[1:]},
                        "UnprocessedKeys": {"groups": {"Keys": keys[:1], "ConsistentRead": True}}}
            return {"Responses": {"groups": keys}}
        table.meta.client.batch_get_item.side_effect = read
        with patch.object(app.time, "sleep"):
            result = app.batch_get(table, "groupKey", [str(i) for i in range(205)] + ["0"])
        self.assertEqual(len(result), 205)
        self.assertEqual([len(call["Keys"]) for call in calls], [100, 1, 100, 5])
        self.assertTrue(all(call["ConsistentRead"] for call in calls))
        self.assertEqual(app.batch_get(table, "groupKey", []), [])

    def test_exhausted_batch_retries_fail_instead_of_returning_partial_roster(self):
        table = Mock()
        table.name = "groups"
        pending = {"groups": {"Keys": [{"groupKey": "a"}], "ConsistentRead": True}}
        table.meta.client.batch_get_item.return_value = {"UnprocessedKeys": pending}
        with patch.object(app.time, "sleep"), self.assertRaises(RuntimeError):
            app.batch_get(table, "groupKey", ["a"])
        self.assertEqual(table.meta.client.batch_get_item.call_count, 6)

    def test_stale_index_membership_is_rechecked_against_removal_tombstone(self):
        key = app.membership_item_key("g", "removed")
        table = FakeGroupTable({key: {"groupKey": key, "recordType": "removedMembership",
                                     "groupId": "g", "userId": "removed"}})
        with patch.object(app, "groups_table", return_value=table), \
             patch.object(table, "query", return_value={"Items": [{"groupKey": key, "recordType": "membership"}]}):
            self.assertEqual(app.group_memberships("g"), [])
            self.assertEqual(app.user_memberships("removed"), [])
