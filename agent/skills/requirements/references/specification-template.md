# Specification Template

## Full Template

```markdown
# Feature: [Name]

## Overview
[2-3 sentence description of the feature and its value to users]

## Functional Requirements

### FR-001: [Requirement Name]
While <precondition>, when <trigger>, the system shall <response>.

### FR-002: [Requirement Name]
While <precondition>, when <trigger>, the system shall <response>.

## Non-Functional Requirements

### Performance
- Response time: < 200ms p95
- Throughput: 1000 requests/minute
- Data volume: Up to 1M records

### Security
- Authentication: JWT required
- Authorization: Role-based (admin, user)
- Data protection: PII encrypted at rest

### Scalability
- Concurrent users: 10,000
- Peak load handling: Auto-scale to 3x
- Data retention: 90 days

## Acceptance Criteria

### AC-001: [Scenario Name]
Given [context/precondition]
When [action taken]
Then [expected result]

### AC-002: [Scenario Name]
Given [context/precondition]
When [action taken]
Then [expected result]

## Error Handling

| Error Condition | HTTP Code | User Message |
|-----------------|-----------|--------------|
| Invalid input | 400 | "Please check your input" |
| Unauthorized | 401 | "Please log in to continue" |
| Forbidden | 403 | "You don't have permission" |
| Not found | 404 | "Resource not found" |
| Conflict | 409 | "This already exists" |

## Out of Scope
- [Feature/capability explicitly not included]
- [Future enhancement to consider later]

## Open Questions
- [ ] [Question needing stakeholder input]
- [ ] [Technical decision pending]
```

## Save Location

Save as: `docs/specs/YYYY-MM-DD-{topic}.spec.md` (project conventions for location override this default)

## Required Sections Checklist

| Section | Purpose | Required |
|---------|---------|----------|
| Overview | Quick understanding | Yes |
| Functional Requirements | What it does | Yes |
| Non-Functional Requirements | How well it does it | Yes |
| Acceptance Criteria | How to verify | Yes |
| Error Handling | Failure cases | Yes |
| Out of Scope | Prevent scope creep | Recommended |
| Open Questions | Track decisions | As needed |
