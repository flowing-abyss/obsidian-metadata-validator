---
name: Book
priority: 20
extends: "schemas/sources"
target:
  folder: "books"
fields:
  status:
    type: text
    label: Status
    required: true
    options:
      - value: "to-read"
        label: To Read
      - value: "reading"
        label: Reading
      - value: "read"
        label: Read
    auto_fix:
      default: "to-read"
  isbn:
    type: text
    label: ISBN
    required: false
  pages:
    type: number
    label: Pages
    required: false
    number_range:
      min: 1
      max: 10000
---

Schema for books. Extends `sources` schema.
