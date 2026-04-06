# Test Vault — Metadata Validator

Тестовое хранилище для прямого функционального тестирования плагина.

## Быстрый старт

1. Собери и установи плагин:
   ```bash
   npm run build:vault
   ```
2. Открой эту папку (`test-vault/`) как vault в Obsidian.
3. Включи плагин: **Settings → Community plugins → Metadata Validator → Enable**.

## Структура схем

```
schemas/
├── manifest.md          ← Base (все заметки, приоритет 0)
├── sources/
│   └── manifest.md      ← Source (папка sources/, приоритет 10)
├── books/
│   └── manifest.md      ← Book extends Source (папка books/, приоритет 20)
└── articles/
    └── manifest.md      ← Article extends Source (sources/ + тег article, приоритет 15)
```

## Тест-кейсы

| Файл | Сценарий | Ожидаемый результат |
|------|----------|---------------------|
| `sources/valid-source.md` | Все поля корректны | Зелёный бейдж |
| `sources/missing-author.md` | Нет обязательного `author` | Красный бейдж, ошибка в sidebar |
| `sources/invalid-rating.md` | `rating: 2000` (допустимо 1–10) | Красный бейдж, ошибка диапазона |
| `sources/invalid-status.md` | `status: kek` (нет в options) | Красный бейдж, ошибка опции |
| `sources/no-status-gets-autofix.md` | Нет поля `status` | Авто-фикс: добавляется `status: new` |
| `books/clean-code.md` | Книга, все поля верны | Зелёный бейдж |
| `books/missing-author-book.md` | Книга без `author` | Красный бейдж |
| `notes/unschemaed-note.md` | Нет подходящей схемы | Нет бейджа |

## Обновить плагин после изменений в коде

```bash
npm run build:vault
# Затем в Obsidian: Settings → Community plugins → отключить/включить Metadata Validator
```
