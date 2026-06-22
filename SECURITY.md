# Security Policy

## Supported Versions

Security fixes are applied to the **latest release only**. We do not backport fixes to older versions.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ Yes |
| Older releases | ❌ No |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, report it privately using one of these methods:

### Option 1 — GitHub Private Security Advisory (Preferred)

Use GitHub's built-in private reporting:

1. Go to the [Security tab](https://github.com/BinderTools/binder/security) of this repository
2. Click **"Report a vulnerability"**
3. Fill out the advisory form

This creates a private discussion between you and the maintainers, with the option to request a CVE.

### Option 2 — Direct Contact

If you are unable to use GitHub's advisory system, contact the maintainers directly through GitHub.

---

## What to Include

A useful vulnerability report includes:

- **Type of issue** — e.g., code injection, path traversal, privilege escalation, information disclosure
- **Affected component** — which file, module, or feature is affected
- **Steps to reproduce** — a minimal, reliable reproduction
- **Impact** — what an attacker could achieve by exploiting this
- **Suggested fix** — optional, but appreciated

---

## Response Timeline

| Stage | Target |
|-------|--------|
| Initial acknowledgment | Within 48 hours |
| Severity assessment | Within 5 business days |
| Fix or mitigation | Depends on severity — critical issues are prioritized |
| Public disclosure | After a fix is released, coordinated with the reporter |

We aim to keep you informed throughout the process and will credit reporters in the release notes unless you prefer to remain anonymous.

---

## Scope

The following are **in scope** for this policy:

- The Binder desktop application (this repository)
- The [Binder Plugin SDK](packages/)
- The [themes repository](app/themes/)
- Official shell backend submodules

The following are **out of scope**:

- Third-party community plugins (report those to the plugin author)
- Community-contributed themes
- Vulnerabilities in Wails, Monaco, xterm.js, or other upstream dependencies (report those to the respective upstream projects)
- Social engineering attacks
- Denial-of-service attacks that require physical access to the machine

---

## Security Considerations for Plugin Authors

Binder plugins execute JavaScript in a sandboxed WebView context. Plugin authors should:

- Not request unnecessary Wails backend bindings
- Not read or write files outside the user's working directory without explicit permission
- Not make network requests to unexpected endpoints
- Follow the principle of least privilege

Plugins that violate these principles may be removed from the in-app store.

---

## Disclosure Policy

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you give us a reasonable amount of time to address the vulnerability before making it public. We will work with you to agree on a disclosure timeline.
