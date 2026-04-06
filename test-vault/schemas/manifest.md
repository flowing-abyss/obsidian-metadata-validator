---
name: Base
priority: 0
target:
  folder: ""
fields:
  status:
    type: text
    label: Status
    required: true
    options:
      - value: "draft"
        label: Draft
      - value: "active"
        label: Active
      - value: "archived"
        label: Archived
    auto_fix:
      default: "draft"
  tags:
    type: multitext
    label: Tags
    required: false
---

Base schema — applies to all notes via folder match.
