# Security Policy

## Supported versions

This project is pre-1.0. Security fixes are applied to the latest code on the
default branch. Older commits and unofficial builds are not supported.

## Reporting a vulnerability

Please do not disclose vulnerabilities in a public issue. Use GitHub's private
vulnerability reporting feature on the repository's **Security** tab. If private
reporting is not available, contact a maintainer privately before sharing details.

Include the affected version or commit, reproduction steps, impact, and any known
mitigation. Maintainers will acknowledge a complete report as soon as practical,
keep you informed while it is investigated, and coordinate disclosure after a fix
is available.

## Deployment model

Remote Development can read and modify files, run terminal processes, and expose
local HTTP services with the permissions of its host user. Treat it as privileged
developer tooling:

- Run it only on a machine and workspace you trust.
- Keep the default loopback binding unless remote access is required.
- Use a strong, unique authentication token for every non-loopback deployment.
- Put internet-facing access behind a maintained TLS reverse proxy and additional
  access controls; direct internet exposure is not a supported deployment model.
- Do not share logs, database files, or terminal output without reviewing them for
  secrets and private source code.
