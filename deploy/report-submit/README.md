# Развёртывание исправления отчёта

Публикация требует отдельной команды пользователя. Этот каталог не запускает
публикацию автоматически. Проверку и установку выполняют в существующей серверной
копии проекта после получения только этой ветки/правки; не заменять сервер старым
`origin/main`. База разработки — `390fff7` с финансовыми исправлениями 31 октября.

## До публикации

1. Read-only проверить реальную функцию/активные триггеры и версии двух API.
   Установщик допускает только точное известное тело функции после миграции
   ручного завершения. Несовпадение — остановка и diff, а не принудительная замена.
2. В изолированной копии серверного runtime проверить эту миграцию и обработчики
   с реальной схемой и отдельными тестовыми мастером/менеджером. Не подключать её
   к рабочей базе, Storage, уведомлениям и Drive на запись.
3. Сохранить предыдущие развернутые API bundles и frontend assets с контрольными
   суммами. Репозиторные исходники могут отличаться от российского runtime:
   не заменять его целиком, не переносить старые адреса из config.js на сервер.
4. Основное устранение причины — новая функция триггера. Установить её первой,
   затем обновить два API и фронтенд с проверками квитанции. Применять весь набор
   миграций заново не нужно. Одна публикация frontend не устраняет причину.

## Короткие команды

Настроенное подключение `psql` берётся из существующего PGSERVICE/PG* или peer.
Пароли не передавать в командной строке. Для контейнера поддерживаются явные
`--container` и `--database`; конкретное подключение сначала подтвердить чтением.
Все примеры ниже выполнять по отдельности, в нужный момент, из корня репозитория.

Read-only:

```sh
python3 deploy/report-submit/database.py check
```

Только после разрешения на publication:

```sh
python3 deploy/report-submit/database.py apply
```

Применение берёт короткую блокировку, проверяет текущую функцию внутри транзакции,
меняет только функцию, сохраняет `report-submit-backup.json` с правами 0600 и
не обновляет ни одной строки заявки. Существующая резервная копия не затирается.
При неизвестном результате снова выполнить `check` перед повтором.

Откат только функции, с проверкой установленной версии и резервной копии:

```sh
python3 deploy/report-submit/database.py rollback
```

БД/файлы отчётов/начисления при откате не удаляются. Сам откат возвращает старую
ошибку для новых отправок; выполнять лишь при подтверждённой регрессии. Два API
и frontend откатываются на сохранённые серверные bundles/assets, а не на старый
main. Сохранить текущие домен/порт и настройки подписи ссылок.

После разрешённой публикации проверить BUILD_ID, две роли, отправку и повторное
открытие тестовой заявки, сохранность согласования, вложения и приёмку. Исторические
заявки восстанавливаются отдельно по процедуре в основном отчёте; установщик их
не исправляет и отчёты повторно не отправляет.

Установщик проверен с PostgreSQL/PGlite. На действующем российском runtime он в
этой сессии не запускался; фактическое подключение и дрейф кода остаются preflight.


## RU runtime package, 11 November 2026

`inspect_runtime.py` compares the active sources and ESZIP source maps. The
observed sources match the report-acceptance deployment at `800b057`, including
its public-storage helper and asynchronous manager-approval logic. Their hashes
are pinned in `overlay.py`. Do not replace these files wholesale with the
canonical API files from this branch.

From the separate checkout, run each command separately:

```sh
python3 deploy/report-submit/release.py stage
```

Staging verifies the live Docker mounts and the frontend manifest, snapshots
sources/bundles/web assets, reproduces both existing bundles with frozen
dependency versions, disconnects the build network, and compiles only the three
receipt-check additions. It preserves the current gateway and shared helpers.
The isolated runtime has dummy credentials, loopback-only mock PostgREST and
Storage, and no connection to production services. It tests uploads and public
URLs, master/manager permissions, submission, review, repeated submissions,
one-time deductions, false-success rejection, and readback after an empty write
response. This is a real Edge runtime with synthetic services, not a production
end-to-end test. The SQL regression was validated separately.

The frontend overlay changes only the report upload module plus its existing
build/version files. Other deployed modules, origins, financial code and the
service worker's behavior are preserved. Unknown source or bundle drift stops
staging. Successful staging prints `STAGE_READY=true` and
`PRODUCTION_CHANGED=false`.

After successful staging and the user's deployment authorization:

```sh
python3 deploy/report-submit/release.py apply
```

Apply rechecks snapshots, backups, candidate checksums and the public baseline,
installs the two API bundles and frontend overlay, restarts only the Edge
container, and verifies health, unauthenticated access rejection and public
asset checksums. On failure it attempts to restore the exact saved files. It
does not run database migrations or change historical orders.

```sh
python3 deploy/report-submit/release.py rollback
```

Rollback refuses to overwrite a touched file changed by another release.
Backups, logs and the release journal stay private in
`/root/bos-report-runtime/stage-*`. This rollback covers API/frontend only;
the separate SQL function backup remains managed by `database.py`.

Local validation: eight deployment regression tests passed, including unknown
baseline refusal, preservation of unrelated bytes/origins, manifest integrity,
idempotent installation, and rollback on health/public-check failures. Python
syntax and the existing uploader JavaScript syntax checks passed. The actual
host build/runtime stage remains pending until the operator runs `stage`.

```sh
python3 -m unittest discover -s deploy/report-submit
```

The fixture sources in `fixtures.json` contain repository code, not business
records: API baseline `800b057`, uploader baseline `390fff7`.
