# Независимая проверка финального diff до коммита

**Checkpoint:** рабочий diff поверх21bc08d1577153a5660e51d65162a3cf079a59e4. Изменения основного агента продолжались во время review; ниже явно разделены найденные и уже исправленные замечания. Тесты/сервер/браузер/production этим reviewer не запускались, исходники не редактировались. Полный новый suite и свежий visual gate **pending**.

## Открытые замечания

### P2 — единственная кнопка master card занимает половину ряда на мобильном

`approved-master-ui.css:265` задаёт `.masterV125Actions` две колонки. Поздний injected stylesheet в `master-orders-v125.js:88` при max-width520 задаёт `.masterV125Actions>*:only-child{grid-column:auto}`. Поэтому у заявки без телефона или в master preview, где ссылка Call намеренно отсутствует, единственная «Открыть заявку» попадает только в первую из двух колонок.

Воспроизведение: master → Мои заявки, активная заявка с пустым phone/client_phone, ширина390; также owner → master preview → Мои заявки. Нативное открытие работает, но новая композиция оставляет пустую половину строки и уменьшает target.

Минимальная правка: scoped `.bos-approved-ui[data-bos-ui-role="master"] .masterV125Actions>:only-child{grid-column:1/-1}`. На момент последнего чтения этой правки ещё нет. Это вывод из композиции CSS; runtime geometry reviewer не измерял.

### Пробел проверки — первый stability test не доказывает identity узлов

`tests/release-final-stability.spec.js:4` наблюдает childList самого сохранённого panel, но не его родителя. Замена panel целиком может оставить observer на detached узле с нулём изменений; новая `.moa179StageCard` при этом проходит завершающую visibility assertion.

Для утверждения из названия «retains its original action nodes» проверить `panel.isConnected`, `document.querySelector(...)===panel` и identity исходной action-кнопки после16frames. Это ограничение доказательства, а не установленный новый runtime дефект. Сообщено основному агенту.

## Замечания, исправленные во время review — статическое подтверждение

| Найдено | Причина | Последнее прочитанное исправление |
|---|---|---|
| P2: адрес с кавычками/апострофом продолжал бесконечный childList churn | `innerHTML` сравнивался с escaped template. `esc` из app-public.js сериализует кавычки как entities, а DOM innerHTML для текстового узла возвращает буквальные кавычки. Пример: ЖК "Море", корпус O'Neil. | `master-order-focus-v126.js:73–75` создаёт структуру один раз и сравнивает/обновляет `b.textContent`. Тест undated теперь содержит обе кавычки. Runtime результат ещё не прочитан. |
| P2: поздний legacy workflow мог внедриться в новую agreement form | v25 guard знал `#masterAgreementForm`, а актуальный v179 создаёт `#masterOrderAgree179Form`. Repro без записи: `openOrder('11');openMasterAgreement('11')` в одном тике. | Современный ID добавлен в v25/v115/v116/v126 guards. v25 также захватывает исходный modal node и проверяет identity в0/90ms callbacks. Добавлен тест отсутствия legacy panel в новой форме. |
| Остаточная избыточная высота employee KPI | Disclosure убрал только3из10 KPI; оставшиеся7 дают4ряда. Базовый `styles.css .metric` min-height130px оставался активен, то есть одна сетка минимум520px. | Добавлен scoped `#modalRoot .modal:has(.bosEmployeeQuality) .grid .metric{min-height:0;...}`. Нижний предел снят. Достаточность компактности ещё требует новой PNG. |

Эти пункты закрыты **статически**, не объявлены runtime PASS.

## Семантика изменённых функций

- **v25/v115/v116 guards:** panel, уже принадлежащий v179, не перезаписывается старыми decorators. Исходные stage/action/API функции в этих файлах не заменены. StageTask, report receipt, report/reschedule/contact forms сохраняются; original-modal identity защищает от поздней вставки в другой открытый modal.
- **v126:** idempotent date/address decoration меняет DOM только при изменении отображаемого содержания. Address через textContent сохраняет escaping и не создаёт XSS. Даты из нормального timestamp форматируются в ту же строку. Позднее присвоение href не наблюдается текущим childList observer.
- **Undated:** `master-orders-v125.js:55,67` добавляет отдельный day-key `undated`, только если есть запись без `groupDate`. `isNew`, `current`, status/stage classifiers, счётчики и API не изменены. У current/new day соответствует scheduled_date; у done/archive сохраняется completion-date grouping. Переключение status по-прежнему сбрасывает day вall. Новый фильтр не переопределяет «Новые».
- **Finance works:** `finance-page.js:129` оборачивает прежний поясняющий текст в details/summary. Текст, `F.workGroups(m.rows)`, колонки и расчёт остаются прежними. Неизвестная разбивка не заменяется нулём.
- **Manager memo:** `manager-memo-editor-v45.js:14` переносит прежний `openManagerMemoEditor()` после командной страницы в details. Проверка managerMode и upload/delete обработчики не менялись; новый независимый редактор не создан.
- **Employee profile:** перенесены только три quality KPI в details; формулы/payroll source, labels/значения, staff management и recent-order handlers сохранены. `.bosEmployeeRecentOrder>b` соответствует фактическому `button>span+b`, nowrap/flex-shrink0 устраняет перенос суммы. Ранние добавленные `.bosEmployeeRecentOrder .row>strong` selectors этому markup не соответствуют, но более поздний `>b` закрывает реальную структуру.
- **CSS tabs / duplicate heading:** flex-wrap + nonshrinking buttons устраняют сжатие подписи без скрытия вкладки. Только внутренний heading/description free-slots скрыт в `.bosOpsFreeTask`; date/slot controls не затронуты.
- **Сетка времени master:** display:contents у верхнего wrapper позволяет времени занять левую колонку, stage остаётся справа. Receipt/address/work/cost/pay nodes сохраняются; обработчики карточки и дочерних действий не меняются.
- **Agreement footer:** добавлен wrapper вокруг прежних submit/cancel, типы кнопок и form.onsubmit сохранены. Современная v179 agreement использует собственный существующий footer, поэтому старый v116 не заменяет её контракт.
- **Новые report radio styles**, появившиеся к концу review, ограничивают visually hidden input размером1px внутри относительно позиционированного label. Input сохраняется; эту focus/overflow правку нужно проверить существующим keyboard/geometry тестом, здесь runtime утверждений нет.

## Primary width и employee layout

Обычный order header реально создаётся `order-filters-v22.js:53` как `#content>.row>button.primary`; owner team — `team-roles-fix-v31.js:24` как `.bosManagementTeam>.row>button.primary`. Новые selectors с width100%!important/max-width:none!important этому markup соответствуют. Team row теперь wrapping flex; order row уже display:grid!important из approved-operations-ui.css:65.

В прочитанных файлах не найден более сильный matching width/max-width override. `form-mobile-fix.css:34` задаёт flex0 0 auto для header primary, но в order grid это не определяет ширину, а новая owner-team flex-basis100% выигрывает нормальный cascade. Потому заявить точную причину старой узкой PNG без computed-style evidence нельзя. Финальная проверка должна измерить фактическую ширину CTA против ширины header на360/390 и посмотреть PNG. Если правило не применяется, проверять matcher, загруженный build/CSS и DOM parent, а не добавлять новые global !important.

Employee: min-height130px был конкретной найденной причиной оставшейся высоты. Новый reset адресует её; props disclosure и вызовы original controls сохранены. Этого недостаточно для автоматического visual PASS.

## Ожидаемое доказательство перед закрытием

1. Новый stability suite: современный panel/action identity; quoted-address mutation count; реальные dated/undated records; быстрый order→agreement переход.
2. Phoneless и preview single-action card геометрия после scoped span fix.
3. Новая CTA/team-member/attention/free-slots/finance-works PNG и ширины; прежние144 reviewed sheets описывают a110, не текущий CSS.
4. Полный новый suite: предыдущие746/2 остаются историческим результатом, новые изменения им не покрыты.
5. Hosted Preview остаётся отдельным незакрытым gate; отсутствие production обращений сохранено.
