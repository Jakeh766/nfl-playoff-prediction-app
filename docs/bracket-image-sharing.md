# Bracket image sharing

Share bracket exports a PNG file, never a prediction URL. The established
1200 × 630 bracket layout renders at 2× resolution (2400 × 1260 pixels), with
an opaque background, team logos, fonts, and branding. Font/asset waits are
bounded; unavailable logos leave readable team names. The encoder checks MIME,
PNG signature, dimensions, and a 5 MiB maximum before enabling sharing/download.
Browser fixtures additionally require the full NFL/NBA PNGs to stay below 1 MiB.

The filename includes sport and season, for example
`predict-playoffs-nfl-2026-bracket.png` or
`predict-playoffs-nba-2026-27-bracket.png`. Native payloads contain only this
file and the short title “My playoff bracket.” Results exports use a results
filename/title. Public fields are selected explicitly; email, Cognito IDs,
private groups, invite codes, and internal identifiers never enter the image
model, filename, payload, or analytics.

## Native sharing and saving

Native sharing requires both `navigator.share` and a successful
`navigator.canShare({files: [preparedFile]})` check. A share call also requires
transient user activation. The flow opens the OS sheet automatically if activation
is still present after generation; otherwise **Share bracket image** gives it a
fresh tap. No rendering/network await intervenes between that tap and the call.
Capabilities are rechecked each time, and concurrent native calls are prevented.
These requirements come from the [Web Share specification](https://www.w3.org/TR/web-share/).

Cancellation is quiet. A native error retains retry and **Download bracket image**.
The download action remains available during native sharing. If generation fails,
the user can close and retry; unusable bytes are never offered as a file.

The preview is the actual exported PNG, so browser image-save menus can operate
on it. If file sharing is absent, unsupported, or blocked, users download/save
the PNG and upload it manually. Download messages acknowledge initiation rather
than claim completion: the browser cannot confirm an OS save. Observable download
failures retain the preview and explain browser save options. Blob URLs live only
for the preview, with a 60-second grace period after download initiation.

On iPhone/iPad, guidance explains that Safari downloads go to Files and that
touch-and-hold exposes image-save options. Apple documents configurable
[Safari download locations](https://support.apple.com/guide/iphone/customize-your-safari-settings-iphb3100d149/ios).
Image-save options vary by OS/browser context; the website cannot force saving
to Photos. WebKit has also documented [differences between sharing and saving images](https://bugs.webkit.org/show_bug.cgi?id=231995).

## Compatibility review

These are expected capability-based paths, not guarantees about an installed app.

| Browser/device | Expected path |
| --- | --- |
| iPhone Safari | Native PNG share sheet when the file check succeeds; fresh tap if generation outlasts activation. PNG download/preview saving remains available. |
| Android Chrome | Same prepared PNG through Android sharing when supported; download and manual upload otherwise. |
| Desktop Chrome/Edge | Native sharing only if that browser/OS supports this file; download otherwise. |
| Desktop Safari | Same capability checks; native macOS sheet or download. |
| Embedded/restricted browsers | Failed/missing file capabilities use PNG download and browser save options. |

| App | Website behavior and limit |
| --- | --- |
| Instagram | Supplies a PNG to the OS. Instagram controls whether it accepts it and offers Feed/Stories; no destination is forced. |
| Facebook | Supplies the PNG; no URL-based Facebook sharer substitutes for the image. |
| Snapchat | Supplies the PNG; no deep links or undocumented destination targeting. |
| Discord | Supplies the PNG file for attachment handling; no public/private bracket URL is attached. |

The website neither discovers installed apps nor controls the OS target list.
If any app is absent, download/save the PNG, open that app, and upload it there.
No app-specific fake buttons, private URLs, or link-copy fallbacks exist.

## Validation boundary

`scripts/check.ps1 -Scope All` includes sharing, editor, privacy, and CSP tests.
`scripts/test-frontend-browser.cjs` uses headless Edge with mocked APIs and native
share capabilities. It verifies actual PNG bytes, MIME, dimensions, opacity,
size, image preview, logos, filename, user-activation paths, cancellation/errors,
generation/download failure, pending-share guards, and mobile overflow. iPhone,
Android, and desktop profiles simulate capability branches and copy in Chromium;
they do not run those operating systems or their native share sheets.

Physical-device/app delivery remains a manual test: on current iPhone Safari
and Android Chrome against dev, save a bracket, share to each installed app,
check the full PNG in its composer, cancel/retry, and download/upload if the
target is absent. Record device, OS/browser/app versions and destination results.
Desktop Safari also needs macOS verification. No social accounts, public posts,
live AWS mutations, or production deployment are part of automated testing.
