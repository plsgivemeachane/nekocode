# Security Policy

## Supported Versions

We actively support the following versions of NekoCode with security updates:

| Version | Supported |
|---|---|
| 0.2.x | :white_check_mark: |
| < 0.2.0 | :x: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue in NekoCode, please report it responsibly.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisories** (preferred): Use the [Security Advisories feature](https://github.com/plsgivemeachane/nekocode/security/advisories/new) to privately report a vulnerability.

2. **Email**: Send a detailed report to the project maintainers. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Include

When reporting a vulnerability, please provide:

- **Type of issue** (e.g., buffer overflow, XSS, privilege escalation, injection, etc.)
- **Full paths of source file(s)** related to the issue
- **The location of the affected source code** (tag/branch/commit or direct URL)
- **Any special configuration** required to reproduce the issue
- **Step-by-step instructions** to reproduce the issue
- **Proof-of-concept or exploit code** (if possible)
- **Impact of the issue**, including how an attacker might exploit it

### Response Timeline

We aim to respond to security reports promptly:

| Stage | Target Timeline |
|---|---|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 5 business days |
| Status update | Within 10 business days |
| Resolution | Varies by complexity |

### Disclosure Policy

- **Do not publicly disclose** the vulnerability until a fix has been released
- We will coordinate with you on the disclosure timeline
- We will credit you in the security advisory (unless you prefer to remain anonymous)

## Security Best Practices for Contributors

When contributing to NekoCode, please follow these security practices:

- **Never commit secrets** — API keys, tokens, passwords, or credentials must not be hardcoded
- **Validate inputs** at process boundaries (Electron IPC, API calls, user input)
- **Sanitize user input** before rendering to prevent XSS
- **Use secure defaults** for all configuration options
- **Handle errors explicitly** — no silent error swallowing
- **Keep dependencies updated** — run `bun audit` regularly
- **Follow Electron security best practices**:
  - Never disable `contextIsolation`
  - Never disable `nodeIntegration` in the renderer
  - Validate all IPC message payloads
  - Use `contextBridge` for preload scripts

## Known Security Considerations

### Electron Security

NekoCode is an Electron application. While we follow Electron security best practices, users should be aware of:

- The app runs with local user privileges
- Extensions run in the main process context
- IPC communication passes between renderer and main processes

### AI Provider Credentials

NekoCode stores API keys for AI providers (Anthropic, OpenAI, etc.) locally on your machine. These credentials are:

- Stored in the local Electron app data directory
- Never transmitted to any server other than the intended AI provider
- Not included in crash reports or analytics

### Extensions

NekoCode supports third-party extensions. Users should:

- Only install extensions from trusted sources
- Review extension code before enabling it
- Be aware that extensions run with full main process access

## Security Updates

Security updates are included in regular releases. We recommend always running the latest version of NekoCode. The app includes an auto-updater that will notify you when a new version is available.

## Contact

For any security-related questions or concerns, please reach out through the methods described above. For general questions, please open a GitHub issue.
