# Независимая визуальная проверка manager / owner

Просмотрены **все 144 пары**: manager64 + owner80, 36 contact sheets. Каждый лист открыт через `view_image`, каждая пара approved/actual рассмотрена. Подробная запись каждого экрана, точные approved/actual пути и путь просмотренного листа: `management-visual-review.json`.

Источник визуальной проверки: `visual-review-sheets/manager-00.jpg`…`manager-15.jpg`, `owner-00.jpg`…`owner-19.jpg`. Manifest этих листов указывает **a110e3c512011d4dece5**, ширина390. Это визуальная проверка сохранённых листов; actual PNG по исходному пути может перезаписываться новой съёмкой. По сообщению основного агента переход к450 меняет только JS races, CSS прежний. Финальные450 PNG этим утверждением не сертифицированы.

Итог классификации: 22 экранных UI_MISMATCH (повторения общих проблем), 15 несовпадений состояния/маршрута съёмки, 84 native функциональных варианта и 23 видимых соответствия с оговорёнными данными/добавлениями/навигацией. Это **не144 PASS**. Никаких тестов, серверов, production-запросов или правок исходников независимый reviewer не выполнял.

## Простые CSS / перестановки существующих блоков

Все ниже P2; P0/P1 по этим изображениям не установлены. Номера листов позволяют воспроизвести сравнение; пути отдельных PNG находятся в JSON.

| Приоритет исправления | Экран и доказательство | Наблюдение и минимальная правка |
|---|---|---|
| 1 | manager06 / owner07, attention | Четыре вкладки столкнулись текстом в одной строке. `approved-operations-ui.css:9`, `.bosOpsTabs button`: добавить nonshrinking width либо перенос с нормальным gap. Не скрывать подписи/счётчики. |
| 2 | owner04, staff-invite | Сумма последних заявок ломается внутри цифр: «4 80 / 0 ₽», «6 00 / 0 ₽». `employee-profile-patch.js:8`, `.bosEmployeeRecentOrder>b`: nowrap + flex-shrink:0; текст слева min-width:0 и переносится. |
| 3 | manager04, staff-access | Вариант manager сливает имя и роль в строке; дать gap/отдельную строку метаданным. Owner16 аналогичный список в другом варианте читаем. Не менять права просмотра/восстановления. |
| 4 | manager00 orders; owner00 orders-new/active; owner01 archive/team | Узкая +Новая в order list и +Сотрудник у owner вместо full-width approved CTA. Финальный CSS растягивает только `.bosOpsWorkspace` (строки214–215), обычный список этим не охвачен. Растянуть существующие CTA, сохранить исходные обработчики. |
| 5 | manager00 team | Панель памятки стоит до заголовка/поиска сотрудников; переставить после списка/вспомогательных действий. Не создавать второй вход или новый редактор. |
| 6 | manager08 / owner09 control | Вводные абзацы, refresh и пять крупных filter tiles занимают почти весь первый viewport. Уплотнить существующие filters и вводный текст, сохранив содержание/управление поручениями. `order-control.js:92,142`. |
| 7 | manager09 / owner09 free-slots | Повторные заголовок и описание внешней страницы и встроенного `.dfs120Head`. Оставить одно вводное описание, controls сохранить; `dispatcher-free-slots-v120.js:80`. |
| 8 | manager02 / owner17 finance-works | Расчётная поясняющая `.finNote` занимает около200px до первого результата. Переместить в явный details/summary; текст об отсутствии разбивки и «—» сохранить дословно. `finance-page.js:129`. |
| 9 | manager01 / owner16 team-member | Большая сетка native вторичных метрик отодвигает последние заявки ниже первого viewport. Сохранить основные показатели, остальное раскрывать через details. `employee-profile-patch.js:5,8`. |
| 10 | manager00 orders / owner00 active / owner01 archive | «Связь не подтверждена» повторяется в summary и добавленном contact block. Убрать только повторное представление, не native contact-actions и не отдельные реальные результаты звонков. |
| Ниже | manager04 / owner02 profile | Plain identity table/text menu вместо approved avatar/menu rows. Это презентационная разница; все основные существующие destinations видимы. |
| Ниже | manager15 / owner15 about | Последняя цифра build ID переносится отдельно. `employee-profile-patch.js:52,56`, `.bosSharedRow`: версия в читаемую отдельную value row или управляемый перенос. |

## Различия, зависящие от настоящих функций

Не устранять простой подгонкой под пример:

- Report/reject: native review, сохранённые денежные комментарии, проверка причины, архив Google Drive и принятие/возврат. Pending report entry открывает bottom sheet, а не proposed full-page tabs.
- Hands: native integration modal и секция внутри order detail включают load active, assign, manual-report, upload. Proposed раздельные read-only страницы не являются исходным API-контрактом.
- Avito: native inbox/search/settings, unlinked vs linked thread, lead form и operational sync/disconnect. Отсутствие linked-order card в unlinked fixture не дефект.
- Finance: saved calculations, active zero-accrual records, extra columns, period/chart grouping, inline filters и expanded master detail. Не подменять суммы sample-значениями и не скрывать неизвестность начисления.
- Assign/reschedule/day-detail/claim/manual-complete/cancel: исходные модальные формы и реальные дополнительные поля/предупреждения. Не добавлять proposal-only fields в API и не менять классификацию/переходы.
- Auth/access/push: native password rules, owner-only actions и фактическая браузерная capability. Expired capture source действительно задаёт expired token/401 (`stage-5/capture-shared-fixtures.cjs:152–155`), но native отображает общий login без proposed expiry explanation.
- Personal/help/viewer: native read-only info и existing viewer Close/Open original; custom menu destinations/zoom toolbar из предложения не гарантированы текущим контрактом.
- More: отсутствие дубликата Finance — намеренное изменение, поскольку Finance теперь пятая вкладка manager/owner.

## Исправить соответствие capture → экран

1. manager/owner schedule: actual первый viewport = free-windows panel; approved = day timeline. Текущий source вызывает native `show('dispatch')` и ждёт `.usManagement`; нужно показать реальную timeline/порядок блоков, не объявлять совпадение.
2. manager/owner workspace: actual dashboard вместо operational workspace queue.
3. manager/owner review/reject: выбран lower/long-comment viewport; нужны отдельные opening/top и lower decision captures. Текущие lower captures полезны для достижимости footer, но не эквивалентны approved top.
4. manager/owner order-delete: source лишь `openOrder('7381707')` и ожидание delete-кнопки (`stage-4/capture-management-fixtures.cjs:99`). Подтверждение удаления не снято; browser confirm следует доказывать dialog event/text.
5. owner loading: native auth boot, а не in-app orders loading. Owner error/offline: dashboard retained-data сценарии, а не proposed order-list error/offline. На просмотренном a110 offline-листе предупреждение не видно; текущий capture source уже ждёт `.odRefreshState:not([hidden])`, поэтому итоговую новую PNG нужно повторно увидеть.
6. owner role-preview: manifest selection показывает уже открытый master profile; chooser и entered preview должны быть отдельными состояниями.
7. owner settings-proposal: сам proposed явно вне утверждённого functional scope; actual owner tools не является реализацией концепта.

Количество15 относится к этим конкретным экранным парам. Capture gaps не означают автоматически15 runtime bugs. Не маркировать их visual PASS до корректной съёмки.

## Последняя проверенная автоматическая evidence

Лично прочитанный `playwright-verified.log`: **746 passed / 2 failed**, build450 по сопутствующим runtime logs. Failures: approved master detail `boundingBox` во время перерендера и dispatcher clear-comment assertion после reload; основной агент расследует. Предыдущие attention reset и smart-dispatch assignment зелёные в этом полном прогоне. Подробности исправленных гонок: `independent-race-review.md`.

Hosted Preview sign-in остаётся заблокированным автоматической проверкой разрешений по сообщению основного агента; hosted gate не PASS. Финальная пересъёмка и повтор после планируемого CSS ещё не рассмотрены.
