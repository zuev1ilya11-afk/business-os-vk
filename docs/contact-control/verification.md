# Проверки

База ветки: `d350079` (main, PR294 safe area). Новая функция проверялась на disposable/fixture-данных; рабочие заявки не изменялись.

| Проверка | Фактический результат |
|---|---|
| `npm run test:server` | 755 passed, 0 failed |
| Новые pilot/manager и старые contact UI | 22 passed, 0 failed |
| Три UI-сценария `contact-control-demo.spec.js` | 1 passed; изображения в `preview/` |
| Сетевая изоляция Playwright | 1 passed; незамокированный внешний URL в основном и дополнительном контекстах блокируется локальным proxy |
| `npm run build` / `npm run build:check` | Pass; единый build `76a7c1736f9c0b36bc31` |
| SQL pilot assertions | Pass в локальном PGlite 0.5.10 (PostgreSQL WASM) |
| Повтор миграции + SQL assertions | Pass в PGlite |
| Старые manual control assertions с новой миграцией | Pass в PGlite |
| `git diff --check`, `bash -n scripts/test-contact-control.sh` | Pass |
| Native PostgreSQL 17.6 и TypeScript | Pass в [CI run 38777540457](https://github.com/zuev1ilya11-afk/business-os-vk/actions/runs/38777540457) |
| Полный Playwright | CI success: 833 passed, 1 flaky (успешный retry), 6 skipped; весь процесс в network namespace |
| Навигация при виртуальных часах | После синхронизации отложенного timer: 5/5 повторов passed |

## Что проверяют контракты

- Все результаты, обязательные поля, попытка vs успешный контакт, атомарное создание поручения, длительность визита и 24:00.
- Точный retry, сохранность более 50 записей пилота, отказ изменённому receipt, старый retry после нового результата, конфликт ревизий.
- Мастер другой заявки, прямой browser RPC, разрешённые роли API, сохранность отчётных операций и зарплатной фильтрации.
- Выходные/будни, отдельный выходной мастера, его смена вне company fallback, достоверный выезд vs только план, граница суток.
- Tick без push, мастер прежде менеджера, очередь 206 заявок, ограничение повторов, sender guard до отправки, выключение флагов при активной lease.
- Передача мастеру вне allowlist с сохранением срока/эскалации, отмена и завершение, смена срока, отсутствие backfill, legacy-сохранение при выключенном флаге.
- Потеря сети и повтор в той же вкладке, бизнес-время при Los Angeles на устройстве, мобильные 320/390, обновление карточки Контроля и главных фильтров, загрузка новой заявки перед результатом.

## Границы доказательств

Локального `psql`/Docker нет; native PostgreSQL-скрипт выполнен успешно в CI с PostgreSQL 17.6. Локально SQL действительно выполнялся embedded PostgreSQL, но это не проверка установленной production БД/расширений.

Локальная попытка `deno check --node-modules-dir=none --no-lock supabase/functions/master-workflow-api/index.ts` остановилась на загрузке npm Supabase dependency (`Connection refused`). Это ошибка доступа к registry, не успешная локальная проверка типов. В CI эта проверка затем прошла.

Первый полный UI-прогон был прерван auto-review из-за адресов общего backend в старых тестах. Добавлен закрытый loopback proxy как на уровне контекста, так и запуска браузера; отдельный тест подтвердил отказ внешнего соединения, включая `browser.newContext()`. Auto-review повторно отклонил полный запуск, поскольку proxy не принят как доказательство изоляции всех прямых запросов. Эти частичные прогоны не засчитываются. В CI добавлен `scripts/test-ui-offline.sh`: весь Node/browser/HTTP-server работает в Linux network namespace с одним loopback, без внешних интерфейсов. При невозможности изоляции скрипт завершается ошибкой без fallback. Локальный `unshare --net` недоступен (`Operation not permitted`), поэтому этот gate должен выполниться в GitHub Actions.

Не проверялись и не изменялись: российский сервер, его cron/systemd, реальные push subscriptions/устройства, доставка внешним push-сервисом, production VAPID/worker credentials. Настоящего staging endpoint для hosted Preview не было. Макеты transport/fixture не выдаются за production-проверку.

Первый полный offline CI прогон выявил два сбоя: online-only GAS health и гонку виртуальных часов в старом тесте dispatcher history. GAS явно пропускается только при `BOS_TEST_OFFLINE=1`; доступность живого bridge не считается проверенной. Для navigation записан trace: отложенный `pushState(dispatch)` запускался виртуальными часами после `pushState(opsScheduleMonth)`. Тест теперь завершает этот timer перед вторым переходом, не меняя навигацию приложения. Повтор CI выполняется с исходным `CI` флагом, переданным через sudo, и с компактным журналом.

## Финальный CI

[Успешный запуск 38777540457](https://github.com/zuev1ilya11-afk/business-os-vk/actions/runs/38777540457) проверил код коммита `45867e8c02e7fb4ebc632d010230f874764c43b8`. После него изменён только этот отчёт и отметка выполнения плана; исполняемый код тот же.

Из 840 UI сценариев: 833 прошли сразу, один тест геометрии dispatcher workspace прошёл при автоматическом retry; 6 явно пропущены. Пропуски: два online GAS health и четыре opt-in задания снимков экранов помощи. Это не скрытые успешные проверки внешних сервисов.

Миграция на PostgreSQL 17.6, её повторное применение, SQL assertions пилота и старых поручений, 755 server tests, TypeScript функций и frozen push runtime прошли. Build `76a7c1736f9c0b36bc31`. PR не merged, RU production не опубликован, флаги пилота не включены.
