# Issue Templates

Copy these templates to `.github/ISSUE_TEMPLATE/` in the repository root.

---

## Bug Report Template

**Filename:** `.github/ISSUE_TEMPLATE/bug_report.yml`

```yaml
name: Bug Report
description: Report a bug or unexpected behavior in NekoCode
title: "[Bug]: "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thank you for reporting a bug! Please fill out the sections below to help us resolve the issue.

  - type: textarea
    id: description
    attributes:
      label: Bug Description
      description: A clear and concise description of what the bug is.
      placeholder: "When I do X, Y happens instead of Z..."
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: Detailed steps to reproduce the behavior.
      placeholder: |
        1. Open NekoCode
        2. Navigate to...
        3. Click on...
        4. See error
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
      description: What did you expect to happen?
      placeholder: "I expected X to happen..."
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Actual Behavior
      description: What actually happened?
      placeholder: "Instead, Y happened..."
    validations:
      required: true

  - type: textarea
    id: screenshots
    attributes:
      label: Screenshots / Logs
      description: If applicable, add screenshots or log output to help explain the problem.
      placeholder: "Paste logs or drag & drop screenshots here..."
    validations:
      required: false

  - type: input
    id: version
    attributes:
      label: NekoCode Version
      description: What version of NekoCode are you running?
      placeholder: "0.2.x"
    validations:
      required: true

  - type: dropdown
    id: os
    attributes:
      label: Operating System
      description: What OS are you running NekoCode on?
      options:
        - Windows
        - macOS
        - Linux
    validations:
      required: true

  - type: textarea
    id: additional
    attributes:
      label: Additional Context
      description: Any other context about the problem (e.g., configuration, extensions enabled, etc.)
    validations:
      required: false
```

---

## Feature Request Template

**Filename:** `.github/ISSUE_TEMPLATE/feature_request.yml`

```yaml
name: Feature Request
description: Suggest a new feature or enhancement for NekoCode
title: "[Feature]: "
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: |
        Thank you for suggesting a feature! Please fill out the sections below.

  - type: textarea
    id: problem
    attributes:
      label: Problem / Motivation
      description: Is your feature request related to a problem? Please describe.
      placeholder: "I'm always frustrated when..."
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Proposed Solution
      description: Describe the solution you'd like to see.
      placeholder: "I would like NekoCode to..."
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives Considered
      description: A clear description of any alternative solutions or features you've considered.
    validations:
      required: false

  - type: textarea
    id: additional
    attributes:
      label: Additional Context
      description: Add any other context, mockups, or screenshots about the feature request here.
    validations:
      required: false
```

---

## Question / Support Template

**Filename:** `.github/ISSUE_TEMPLATE/question.yml`

```yaml
name: Question
description: Ask a question about using or developing NekoCode
title: "[Question]: "
labels: ["question"]
body:
  - type: markdown
    attributes:
      value: |
        Have a question about NekoCode? We're happy to help!

  - type: textarea
    id: question
    attributes:
      label: Your Question
      description: What would you like to know?
    validations:
      required: true

  - type: textarea
    id: context
    attributes:
      label: Context
      description: Any relevant context (what you've tried, documentation you've read, etc.)
    validations:
      required: false

  - type: input
    id: version
    attributes:
      label: NekoCode Version
      description: What version of NekoCode are you using?
      placeholder: "0.2.x"
    validations:
      required: false
```

---

## Config File

**Filename:** `.github/ISSUE_TEMPLATE/config.yml`

This file controls the issue template chooser page:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security Vulnerability
    url: https://github.com/plsgivemeachane/nekocode/security/advisories/new
    about: Please report security vulnerabilities through GitHub Security Advisories, not as public issues.
  - name: Documentation
    url: https://github.com/plsgivemeachane/nekocode#readme
    about: Check the README and documentation before opening an issue.
```
