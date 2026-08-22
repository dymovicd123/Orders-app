# Проверка и развёртывание

Откройте PowerShell в корне проекта, где находится `package.json`.

Первичная установка после получения чистого архива:

```powershell
npm ci
```

Полная проверка перед деплоем:

```powershell
npm run release:check
```

Деплой:

```powershell
npm run deploy
```

Если Wrangler запросит вход:

```powershell
npx wrangler login
npm run deploy
```

После деплоя обновите страницу через `Ctrl + F5`.

Рефакторинг структуры не меняет D1, поэтому миграции для него запускать не нужно.
