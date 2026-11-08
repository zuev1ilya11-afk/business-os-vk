import { requestId } from "../lib/request-id";
import { useEffect, useRef, useState } from "react";
import type { LegalDocument, Service } from "../lib/types";
import { company } from "../lib/company";
import { track, attribution } from "../lib/analytics";
import { money, price } from "./Catalog";
export async function request(path: string, body?: unknown, csrf?: string) {
  const r = await fetch("/client-api" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      data.error || "Не удалось выполнить действие. Повторите позже.",
    );
  return data;
}
export function ConsentFields({
  documents,
  values,
  onChange,
}: {
  documents: LegalDocument[];
  values: string[];
  onChange: (x: string[]) => void;
}) {
  return (
    <div className="consents">
      {documents
        .filter((d) => d.required)
        .map((d) => (
          <label key={d.document}>
            <input
              type="checkbox"
              required
              checked={values.includes(d.document)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...values, d.document]
                    : values.filter((x) => x !== d.document),
                )
              }
            />
            <span>
              Принимаю{" "}
              <a
                href={"/documents/" + d.document}
                target="_blank"
                rel="noreferrer"
              >
                {d.title.toLowerCase()}
              </a>
              <small>
                Версия {d.version}
                {!d.reviewed ? " · тестовый документ" : ""}
              </small>
            </span>
          </label>
        ))}
      <p className="fine">
        Ознакомьтесь с{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">
          политикой конфиденциальности
        </a>
        . Согласие на рекламу не запрашивается.
      </p>
    </div>
  );
}
const empty = {
  name: "",
  phone: "",
  description: "",
  address: "",
  entrance: "",
  floor: "",
  intercom: "",
  desired_date: "",
  desired_interval: "10:00–13:00",
  comment: "",
};
type Item = {
  service_id: string;
  quantity: number;
  parameters: Record<string, string | number | boolean>;
};
type Quote = {
  total: number | null;
  minimum_total: number;
  requires_clarification: boolean;
  items: {
    name: string;
    quantity: number;
    unit: string;
    amount: number | null;
  }[];
};
export default function OrderForm({
  services,
  documents,
  quick = false,
  selected = "",
  staging = false,
}: {
  services: Service[];
  documents: LegalDocument[];
  quick?: boolean;
  selected?: string;
  staging?: boolean;
}) {
  const [step, setStep] = useState(quick ? 1 : 0),
    [items, setItems] = useState<Item[]>(
      services.some((s) => s.id === selected)
        ? [{ service_id: selected, quantity: 1, parameters: {} }]
        : [],
    ),
    [data, setData] = useState(empty),
    [files, setFiles] = useState<File[]>([]),
    [consents, setConsents] = useState<string[]>([]),
    [quote, setQuote] = useState<Quote | null>(null),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState<string | null>(null),
    [complete, setComplete] = useState(false),
    [offline, setOffline] = useState(false),
    [retryAt, setRetryAt] = useState(0),
    [tick, setTick] = useState(0);
  const title = useRef<HTMLHeadingElement>(null),
    key = useRef(""),
    token = useRef(""),
    sent = useRef(new Set<File>()),
    payload = useRef<unknown>(null);
  useEffect(() => {
    key.current = requestId();
    track("start_order");
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    title.current?.focus();
  }, [step]);
  const set = (field: keyof typeof empty, value: string) => {
    setData((d) => ({ ...d, [field]: value }));
  };
  const changeItem = (id: string, patch: Partial<Item>) =>
    setItems((a) =>
      a.map((i) => (i.service_id === id ? { ...i, ...patch } : i)),
    );
  const param = (id: string, k: string, v: string | boolean) =>
    setItems((a) =>
      a.map((i) =>
        i.service_id === id
          ? { ...i, parameters: { ...i.parameters, [k]: v } }
          : i,
      ),
    );
  const next = async () => {
    setError("");
    setBusy(true);
    try {
      if (step === 0 && !items.length)
        throw Error("Выберите работу или нажмите «Не знаю, что выбрать».");
      if (step === 1 && !items.length && !data.description.trim())
        throw Error("Опишите задачу.");
      if (step === 3) {
        const r = await request("/website/quote", {
          items,
          city: company.city,
        });
        setQuote(r.quote);
      }
      if (step === 4) {
        if (!documents.length)
          throw Error("Документы сейчас недоступны. Повторите позже.");
        if (documents.some((d) => d.required && !consents.includes(d.document)))
          throw Error("Подтвердите обязательные документы.");
        const r = await request("/auth/request", { phone: data.phone });
        track("submit_phone");
        setChallenge(r.challenge_id);
        setRetryAt(Date.now() + r.retry_after * 1000);
      }
      setStep((s) => s + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await request("/auth/request", { phone: data.phone });
      setChallenge(r.challenge_id);
      setRetryAt(Date.now() + r.retry_after * 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (!token.current) {
        const auth = await request("/auth/verify", {
          challenge_id: challenge,
          code,
          consents: documents
            .filter((d) => consents.includes(d.document))
            .map(({ document, version }) => ({ document, version })),
        });
        token.current = auth.csrf_token;
        track("otp_verified");
      }
      let orderId = created;
      if (!orderId) {
        if (!payload.current) {
          const { phone, ...orderData } = data;
          void phone;
          payload.current = {
            ...orderData,
            request_id: key.current,
            items,
            city: company.city,
            parameters: {},
            utm: attribution(),
          };
        }
        const r = await request(
          "/website/orders",
          payload.current,
          token.current,
        );
        orderId = r.order.id;
        setCreated(orderId);
        track("order_created");
      }
      for (const file of files) {
        if (sent.current.has(file)) continue;
        const b64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1]);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        await request(
          "/orders/" + orderId + "/attachments",
          {
            request_id: key.current + "-photo-" + files.indexOf(file),
            name: file.name,
            mime: file.type,
            data_base64: b64,
          },
          token.current,
        );
        sent.current.add(file);
        track("upload_photo");
      }
      setComplete(true);
    } catch (e) {
      setError(
        (created
          ? "Заявка создана. Можно повторить загрузку фотографий: "
          : "") + (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  void tick;
  if (complete)
    return (
      <section className="success-panel">
        <span className="success-mark">✓</span>
        <h1>Заявка принята</h1>
        <p>
          Номер {created}. Компания уточнит детали, стоимость и время визита.
        </p>
        <a
          className="button"
          href={company.cabinet + "#order/" + created}
          onClick={() => track("open_cabinet")}
        >
          Открыть мою заявку ↗
        </a>
        <p className="fine">Мастер и сообщения появятся в этой же заявке.</p>
      </section>
    );
  return (
    <div className="order-layout">
      <section className="form-panel">
        <div className="step-top">
          <span>Шаг {step + 1} из 6</span>
          <span>
            {
              [
                "Работы",
                "Задача",
                "Адрес и время",
                "Контакты",
                "Проверка",
                "Подтверждение",
              ][step]
            }
          </span>
        </div>
        <progress value={step + 1} max={6} aria-label="Прогресс оформления" />
        <h1 ref={title} tabIndex={-1}>
          {
            [
              "Что нужно сделать?",
              "Расскажите о задаче",
              "Куда и когда приехать?",
              "Как с вами связаться?",
              "Всё верно?",
              "Подтвердите телефон",
            ][step]
          }
        </h1>
        {offline && (
          <p className="error" role="status">
            Нет подключения. Данные останутся на этой странице до восстановления
            связи.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            step === 5 ? void submit() : void next();
          }}
        >
          {step === 0 && (
            <>
              <div className="select-services">
                {services.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={items.some((i) => i.service_id === s.id)}
                      onChange={(e) =>
                        setItems((a) =>
                          e.target.checked
                            ? [
                                ...a,
                                {
                                  service_id: s.id,
                                  quantity: 1,
                                  parameters: {},
                                },
                              ]
                            : a.filter((i) => i.service_id !== s.id),
                        )
                      }
                    />
                    <span>
                      <b>{s.name}</b>
                      <small>{price(s)}</small>
                    </span>
                  </label>
                ))}
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setItems([]);
                  setStep(1);
                }}
              >
                Не знаю, что выбрать →
              </button>
            </>
          )}
          {step === 1 && (
            <>
              {items.map((i) => {
                const s = services.find((s) => s.id === i.service_id)!;
                return (
                  <fieldset key={i.service_id}>
                    <legend>{s.name}</legend>
                    <div className="fields two">
                      <label>
                        Количество, {s.unit}
                        <input
                          type="number"
                          min="0.01"
                          max="10000"
                          step="0.01"
                          required
                          value={i.quantity}
                          onChange={(e) =>
                            changeItem(i.service_id, {
                              quantity: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Длина, м
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          step="0.01"
                          value={String(i.parameters.length || "")}
                          onChange={(e) =>
                            param(i.service_id, "length", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Высота, м
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          step="0.01"
                          value={String(i.parameters.height || "")}
                          onChange={(e) =>
                            param(i.service_id, "height", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Материал стены / потолка
                        <input
                          maxLength={100}
                          value={String(i.parameters.wall_material || "")}
                          onChange={(e) =>
                            param(i.service_id, "wall_material", e.target.value)
                          }
                          placeholder="Если известен"
                        />
                      </label>
                      <label>
                        Тип крепления
                        <input
                          maxLength={100}
                          value={String(i.parameters.mounting_type || "")}
                          onChange={(e) =>
                            param(i.service_id, "mounting_type", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Расходные материалы
                        <input
                          maxLength={100}
                          value={String(i.parameters.materials || "")}
                          onChange={(e) =>
                            param(i.service_id, "materials", e.target.value)
                          }
                          placeholder="Есть / нужны / уточнить"
                        />
                      </label>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!i.parameters.dismantling}
                        onChange={(e) =>
                          param(i.service_id, "dismantling", e.target.checked)
                        }
                      />{" "}
                      Нужен демонтаж
                    </label>
                  </fieldset>
                );
              })}
              <label>
                Что нужно сделать?{!items.length ? " *" : ""}
                <textarea
                  maxLength={5000}
                  required={!items.length}
                  value={data.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Что установить или исправить? Что уже куплено?"
                  rows={4}
                />
              </label>
              <label className="upload-box">
                Фотографии задачи{" "}
                <small>JPEG, PNG, WebP · до 5 МБ · до 10 фото</small>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => {
                    const list = Array.from(e.target.files || []);
                    if (
                      list.length > 10 ||
                      list.some(
                        (f) =>
                          f.size > 5 * 1024 * 1024 ||
                          !["image/jpeg", "image/png", "image/webp"].includes(
                            f.type,
                          ),
                      )
                    ) {
                      setError(
                        "Выберите до 10 фотографий, каждая не больше 5 МБ.",
                      );
                      e.target.value = "";
                      return;
                    }
                    setError("");
                    setFiles(list);
                  }}
                />
              </label>
              {files.length > 0 && (
                <ul className="file-list">
                  {files.map((f, i) => (
                    <li key={i}>
                      {f.name}
                      <button
                        type="button"
                        aria-label={"Убрать " + f.name}
                        onClick={() =>
                          setFiles((x) => x.filter((_, n) => n !== i))
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {step === 2 && (
            <div className="fields">
              <p className="note">
                Санкт-Петербург. Стоимость выезда и доступность адреса уточним
                при согласовании.
              </p>
              <label>
                Адрес *
                <input
                  autoComplete="street-address"
                  required
                  maxLength={1000}
                  value={data.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Улица, дом, квартира"
                />
              </label>
              <div className="fields three">
                {(["entrance", "floor", "intercom"] as const).map((k, i) => (
                  <label key={k}>
                    {["Подъезд", "Этаж", "Домофон"][i]}
                    <input
                      maxLength={120}
                      value={data[k]}
                      onChange={(e) => set(k, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <div className="fields two">
                <label>
                  Желаемая дата *
                  <input
                    type="date"
                    required
                    min={new Date().toLocaleDateString("en-CA", {
                      timeZone: "Europe/Moscow",
                    })}
                    value={data.desired_date}
                    onChange={(e) => set("desired_date", e.target.value)}
                  />
                </label>
                <label>
                  Время, МСК *
                  <select
                    required
                    value={data.desired_interval}
                    onChange={(e) => set("desired_interval", e.target.value)}
                  >
                    {[
                      "10:00–13:00",
                      "13:00–16:00",
                      "16:00–19:00",
                      "19:00–20:00",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="fine">
                Это пожелание. Точное время подтвердит компания.
              </p>
            </div>
          )}
          {step === 3 && (
            <div className="fields">
              <label>
                Ваше имя *
                <input
                  autoComplete="given-name"
                  maxLength={120}
                  required
                  value={data.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>
              <label>
                Телефон *
                <input
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  required
                  maxLength={32}
                  pattern="[+0-9() -]{10,32}"
                  value={data.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+7 (___) ___-__-__"
                />
              </label>
              <p className="fine">
                На следующем шаге подтвердите телефон одноразовым кодом.
              </p>
            </div>
          )}
          {step === 4 && (
            <>
              <div className="review">
                <h2>Состав работ</h2>
                {quote?.items.length ? (
                  quote.items.map((i, n) => (
                    <p key={n}>
                      {i.name}
                      <b>
                        {i.quantity} {i.unit}
                      </b>
                    </p>
                  ))
                ) : (
                  <p>Состав работ требует уточнения</p>
                )}
                <p>{data.description}</p>
                <hr />
                <p>
                  {data.name} · {data.phone}
                </p>
                <p>{data.address}</p>
                <p>
                  {data.desired_date} · {data.desired_interval} МСК
                </p>
                <p>Фотографии: {files.length}</p>
                <hr />
                <p>
                  Предварительная стоимость
                  <b>
                    {quote?.total != null
                      ? money(quote.total)
                      : quote?.minimum_total
                        ? "от " + money(quote.minimum_total)
                        : "После уточнения"}
                  </b>
                </p>
                <p className="fine">
                  Выезд, материалы и дополнительные работы согласуются отдельно.
                  Без согласования состав работ не расширяется.
                </p>
              </div>
              <ConsentFields
                documents={documents}
                values={consents}
                onChange={setConsents}
              />
            </>
          )}
          {step === 5 && (
            <>
              <p>Введите код для {data.phone}.</p>
              {staging && (
                <p className="note">
                  Тестовая доставка: SMS не отправляется. Код доступен
                  проверяющему в закрытом журнале тестовой среды.
                </p>
              )}
              <label>
                Код подтверждения
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required={!token.current}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={!!token.current}
                />
              </label>
              {!token.current && (
                <button
                  className="text-button"
                  type="button"
                  disabled={remaining > 0 || busy}
                  onClick={() => void resend()}
                >
                  {remaining > 0
                    ? `Повторный код через ${remaining} с`
                    : "Отправить код повторно"}
                </button>
              )}
              {created && (
                <p className="note">
                  Заявка №{created} сохранена. Повторная отправка продолжит
                  загрузку фото.
                </p>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            {step > 0 && !created && !payload.current && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setStep((s) => s - 1);
                  setError("");
                }}
              >
                Назад
              </button>
            )}
            <button className="button" disabled={busy || offline} type="submit">
              {busy
                ? "Подождите…"
                : step === 5
                  ? created
                    ? "Повторить загрузку"
                    : "Создать заявку"
                  : step === 4
                    ? "Получить код"
                    : "Продолжить"}{" "}
              <span>→</span>
            </button>
          </div>
        </form>
      </section>
      <aside className="order-aside">
        <span className="eyebrow">ВАША ЗАЯВКА</span>
        <h2>
          Дела по дому —<br />
          под контролем.
        </h2>
        <p>
          После отправки всё будет в одном месте: мастер, время визита, смета и
          переписка.
        </p>
        <ol>
          <li>Опишите задачу</li>
          <li>Согласуйте детали</li>
          <li>Следите за заявкой в кабинете</li>
        </ol>
        <div className="mini-guarantee">✓ {company.guarantee}</div>
        <p className="fine">{company.guaranteeNote}</p>
      </aside>
    </div>
  );
}
export function BusinessForm({
  documents,
  staging,
}: {
  documents: LegalDocument[];
  staging: boolean;
}) {
  const [values, setValues] = useState({
      company: "",
      contact_name: "",
      email: "",
      description: "",
      objects_count: 1,
      comment: "",
      phone: "",
    }),
    [consents, setConsents] = useState<string[]>([]),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const key = useRef(""),
    csrf = useRef("");
  useEffect(() => {
    key.current = requestId();
  }, []);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (!challenge) {
        if (
          !documents.length ||
          documents.some((d) => d.required && !consents.includes(d.document))
        )
          throw Error("Подтвердите документы.");
        const r = await request("/auth/request", { phone: values.phone });
        setChallenge(r.challenge_id);
        track("submit_phone");
      } else {
        if (!csrf.current) {
          const auth = await request("/auth/verify", {
            challenge_id: challenge,
            code,
            consents: documents
              .filter((d) => consents.includes(d.document))
              .map(({ document, version }) => ({ document, version })),
          });
          csrf.current = auth.csrf_token;
          track("otp_verified");
        }
        const { phone, ...body } = values;
        void phone;
        await request(
          "/website/business-leads",
          { ...body, request_id: key.current, utm: attribution() },
          csrf.current,
        );
        track("business_lead_created");
        setDone(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <div className="success-panel">
        <h2>Обращение принято</h2>
        <p>
          Компания свяжется с вами, чтобы обсудить объекты, задачи и условия.
        </p>
      </div>
    );
  return (
    <form
      className="form-panel"
      id="business-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>Обсудим вашу задачу</h2>
      {!challenge ? (
        <>
          <div className="fields two">
            {(["company", "contact_name", "phone", "email"] as const).map(
              (k, i) => (
                <label key={k}>
                  {["Компания *", "Контактное лицо *", "Телефон *", "Email"][i]}
                  <input
                    type={
                      k === "email" ? "email" : k === "phone" ? "tel" : "text"
                    }
                    required={k !== "email"}
                    maxLength={k === "email" ? 254 : 200}
                    value={values[k]}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [k]: e.target.value }))
                    }
                  />
                </label>
              ),
            )}
          </div>
          <label>
            Количество объектов *
            <input
              type="number"
              min={1}
              max={10000}
              required
              value={values.objects_count}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  objects_count: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Описание задачи *
            <textarea
              required
              rows={4}
              maxLength={5000}
              value={values.description}
              onChange={(e) =>
                setValues((v) => ({ ...v, description: e.target.value }))
              }
            />
          </label>
          <label>
            Комментарий
            <textarea
              rows={2}
              maxLength={2000}
              value={values.comment}
              onChange={(e) =>
                setValues((v) => ({ ...v, comment: e.target.value }))
              }
            />
          </label>
          <ConsentFields
            documents={documents}
            values={consents}
            onChange={setConsents}
          />
        </>
      ) : (
        <>
          <p>Подтвердите телефон {values.phone}</p>
          {staging && (
            <p className="note">Тестовая доставка. Реальные SMS отключены.</p>
          )}
          <label>
            Код подтверждения
            <input
              required={!csrf.current}
              pattern="[0-9]{6}"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
            />
          </label>
          {!csrf.current && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setChallenge("");
                setCode("");
              }}
            >
              Изменить данные
            </button>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy
          ? "Отправляем…"
          : challenge
            ? "Отправить обращение"
            : "Получить код"}{" "}
        ↗
      </button>
    </form>
  );
}
