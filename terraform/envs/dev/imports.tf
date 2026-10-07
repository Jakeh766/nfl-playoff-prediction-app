# Adopt the existing dev administrators without recreating their group.
# Retain this idempotent block as a record of the original import.
import {
  to = module.nfl_app.aws_cognito_user_group.admin[0]
  id = "us-east-1_aoY8qzW0r/admin"
}
