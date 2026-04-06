---
name: Article
priority: 15
extends: "schemas/sources"
target:
  folder: "sources"
  tag: "article"
  op: AND
fields:
  url:
    type: text
    label: URL
    required: true
  published:
    type: date
    label: Published
    required: false
---

Schema for articles (notes in sources/ with tag "article"). Extends sources.
