# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

The Authenticode private key is held in SignPath’s HSM. It is not in this repository and is not a GitHub secret. Windows may show the publisher as **SignPath Foundation**, not Trali.

## What is signed

Only the Windows NSIS installer (`.exe`) from a `v*` tag build of this repository. Pull requests and pushes to `main` are not signed. macOS, Linux, and the Windows MSI are not signed in this round.

Each signing request is submitted by GitHub Actions from that tag’s CI build. Locally built installers are not submitted.

## Team roles

| Role | Members |
|------|---------|
| Committers and reviewers | [finnzio](https://github.com/finnzio) |
| Approvers | [finnzio](https://github.com/finnzio) |

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

Translation and proofreading requests go from the user’s machine to the model provider they configure. Trali does not relay that traffic. How the chosen provider handles text is governed by that provider’s privacy policy.

SignPath receives only the Windows NSIS installer, the signing-request details, and GitHub-provided build-origin metadata needed to sign official releases.
