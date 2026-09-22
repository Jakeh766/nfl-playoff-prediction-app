"""Run both sports within the existing scheduled Lambda and IAM permissions."""
import logging


def handler(event, context):
    import nba_results_updater
    import results_updater

    event = event if isinstance(event, dict) else {}
    if event.get("sport") == "nba":
        return nba_results_updater.handler(event, context)
    if event.get("source") != "aws.events":
        return results_updater.handler(event, context)

    results = {}
    failed = []
    for sport, updater in (("nfl", results_updater), ("nba", nba_results_updater)):
        try:
            results[sport] = updater.handler(event, context)
        except Exception:
            logging.exception("%s results ingestion failed", sport)
            failed.append(sport)
    if failed:
        raise RuntimeError("Results ingestion failed for " + ", ".join(failed))
    return results
