# Predict Playoffs

Pick the NFL and NBA playoff teams, predict who wins each round, and see how
your picks compare with friends.

[Open Predict Playoffs](https://predictplayoffs.com/)

## How it works

1. Choose NFL or NBA using the sport selector.
2. Choose the playoff teams and put them in seed order (their playoff ranking).
3. Pick the winners through the Super Bowl or NBA Finals.
4. Create an account, choose a public name, and save your bracket.
5. Follow your score on the public leaderboard or compete in a private group.

You can try the bracket builder without an account. An account lets you save
one prediction per sport and reopen it later. You can change saved picks until
that sport's regular season starts; the app shows the deadline.

Your account and public name work for both sports. Scores and predictions are
separate. A private group can include NFL, NBA, or both.

## What can you predict?

| | NFL | NBA |
| --- | --- | --- |
| Playoff field | Seven teams from each conference | Eight teams from each conference, after the Play-In |
| Team order | Seeds 1–7, including division winners | Seeds 1–8 |
| Playoff picks | Every round through the Super Bowl | Every series through the NBA Finals |

NFL teams are reseeded after the Wild Card round: the highest remaining seed
plays the lowest. NBA uses a fixed bracket, with no reseeding or Play-In picks.
Projected season win totals help you compare teams while making your choices.

## How scoring works

- **Classic:** Earn points for correct playoff teams, seed positions, and teams
  advancing through each round. NFL also awards division-winner points. A perfect
  bracket earns **300 points** in either sport.
- **Upset Edge:** Uses the same picks, but awards more points for teams with
  lower preseason projected win totals. Those scoring weights stay fixed for
  the season.

A wrong early-round pick does not stop you earning points for a correct
later-round pick. The public leaderboard lets you compare both scoring modes.
Private groups keep the mode chosen when the group was created.

See the app's [scoring page](https://predictplayoffs.com/scoring) for the full rules.

## Playing with friends

Open **Groups** at `/groups` to see all your NFL and NBA groups. Each group has
Standings, Members, History, and Settings tabs. Create a private group and share
its invite link, or join with the group's name
and password. Only members can view its leaderboard. The group commissioner
(the person managing the group) can change which sports it includes or delete
it. A commissioner must hand that role to another member before leaving.

## Preview the app on your computer

For development on Windows, install **Node.js 24, Python 3.13, and Terraform
1.15.7**. Open PowerShell in this folder and run setup once:

```powershell
.\scripts\setup.ps1
```

Start the local preview:

```powershell
.\.venv\Scripts\python.exe -m http.server 8000 --directory frontend
```

Open [localhost:8000](http://localhost:8000). Stop the preview with `Ctrl+C`.
You can build brackets and see bundled win projections. Signing in, saving
picks, private groups, and live data require the deployed app.

The basic preview uses file addresses such as `/picks.html`,
`/leaderboard.html`, `/groups.html`, and `/scoring.html`. Add `?sport=nba` to preview NBA.

Before sending code changes, run:

```powershell
.\scripts\check.ps1 -Scope All
```

## For people maintaining the project

The browser app is plain HTML, CSS, and JavaScript. AWS runs the API and stores
saved data. GitHub Actions checks and deploys changes.

| Where to look | What it contains |
| --- | --- |
| `frontend/` | Pages, styles, and browser behavior |
| `backend/lambda/` | Saved picks, scoring, groups, results, and analytics |
| `backend/custom-email-sender/` | Account verification and password-reset emails |
| `backend/test_*` | Automated checks for application behavior |
| `scripts/` | Local setup and validation tools |
| `terraform/` | AWS infrastructure |
| `docs/` | Detailed maintenance guides |

Start with the [development guide](docs/development.md) for the code map and
checks, or the [season guide](docs/season-maintenance.md) for scoring data and
annual updates. Deployment and email setup are in the
[infrastructure guide](terraform/README.md).

Pushing to `dev` automatically checks and deploys the development app.
Production uses the separate `prod` branch and is promoted deliberately after
validation.

Both environments have a private analytics dashboard restricted to their own
Cognito admins; production traffic uses the existing guarded GoatCounter site; active-time collection uses the same privacy guards in both environments. Read
[analytics setup and metric definitions](docs/admin-analytics.md) or the app's
[privacy policy](https://predictplayoffs.com/privacy) for collection details.
