---
name: Source
priority: 10
target:
  folder: "sources"
fields:
  status:
    type: text
    label: Status
    required: true
    options:
      - value: "new"
        label: New
      - value: "reading"
        label: Reading
      - value: "done"
        label: Done
    auto_fix:
      default: "new"
  rating:
    type: number
    label: Rating
    required: false
    number_range:
      min: 1
      max: 10
  url:
    type: text
    label: URL
    required: false
  author:
    type: text
    label: Author
    required: true
---

Schema for all notes in the `sources/` folder.
