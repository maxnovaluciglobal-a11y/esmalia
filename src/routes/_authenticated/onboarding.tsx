import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, Loader2, Plus, Trash2 } from "lucide-react";

import { completeClinicSetup, getMyClinics } from "@/lib/onboarding.functions";
import { COUNTRIES, SPECIALTY_PRESETS } from "@/lib/onboarding-types";
import { EsmaliaLogo } from "@/components/esmalia-logo";
import { cn } from "@/lib/utils";
import { peekPlanIntent } from "@/lib/marketing/plan-intent";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Configura tu clínica — Esmalia" },
      {
        name: "description",
        content:
          "Asistente de primera configuración: crea tu clínica, su sucursal, boxes, especialidades y equipo profesional.",
      },
      { property: "og:title", content: "Configura tu clínica — Esmalia" },
      {
        property: "og:description",
        content: "Deja tu clínica dental operativa en cuatro pasos con Esmalia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OnboardingPage,
});

type ProfessionalDraft = {
  fullName: string;
  email: string;
  licenseNumber: string;
  specialtyName: string;
  color: string;
};

const STEPS = ["Clínica", "Sucursal y boxes", "Especialidades", "Equipo"] as const;

function OnboardingPage() {
  const navigate = useNavigate();
  const fetchClinics = useServerFn(getMyClinics);
  const saveSetup = useServerFn(completeClinicSetup);

  const clinicsQuery = useQuery({ queryKey: ["my-clinics"], queryFn: () => fetchClinics({}) });

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [country, setCountry] = useState<string>("CL");
  const countryConfig = useMemo(
    () => COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0],
    [country],
  );

  const [clinicName, setClinicName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");

  const [branchName, setBranchName] = useState("Sucursal principal");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [opensAt, setOpensAt] = useState("08:00");
  const [closesAt, setClosesAt] = useState("20:00");
  const [operatories, setOperatories] = useState<string[]>(["Box 1", "Box 2"]);

  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>(["Odontología general"]);

  const [professionals, setProfessionals] = useState<ProfessionalDraft[]>([
    { fullName: "", email: "", licenseNumber: "", specialtyName: "", color: "#a8772c" },
  ]);

  const mutation = useMutation({
    mutationFn: async () =>
      saveSetup({
        data: {
          clinic: {
            name: clinicName,
            legalName,
            taxId,
            country: countryConfig.code,
            currency: countryConfig.currency,
            timezone: countryConfig.timezone,
          },
          branch: {
            name: branchName,
            address,
            city,
            phone,
            opensAt,
            closesAt,
            operatories: operatories.filter((o) => o.trim().length > 0),
          },
          specialties: SPECIALTY_PRESETS.filter((s) => selectedSpecialties.includes(s.name)).map(
            (s) => ({ ...s }),
          ),
          professionals: professionals
            .filter((p) => p.fullName.trim().length > 1)
            .map((p) => ({ ...p })),
        },
      }),
    onSuccess: () => {
      // No consumimos acá (borra recién en /suscripcion): si el checkout
      // automático de esa pantalla falla o el usuario navega antes de que
      // dispare, la intención de compra sigue viva para el próximo intento.
      const plan = peekPlanIntent();
      navigate({ to: plan ? "/suscripcion" : "/dashboard" });
    },
    onError: (err: Error) => setError(err.message),
  });

  const stepValid = [
    clinicName.trim().length > 1,
    branchName.trim().length > 1 && operatories.some((o) => o.trim().length > 0),
    selectedSpecialties.length > 0,
    professionals.some((p) => p.fullName.trim().length > 1),
  ][step];

  const existing = clinicsQuery.data ?? [];

  return (
    <div className="min-h-dvh bg-surface px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <EsmaliaLogo size={28} />
            {/* Con una clínica ya creada, el asistente tiene salida: antes la
                única forma de volver era el botón "atrás" del navegador. */}
            {existing.length > 0 && (
              <Link
                to="/dashboard"
                className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="size-4" aria-hidden />
                Cancelar y volver a mi clínica
              </Link>
            )}
          </div>
          <h1 className="font-display text-2xl font-semibold sm:text-3xl">
            {existing.length > 0 ? "Crea otra clínica" : "Configura tu clínica"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuatro pasos para dejar la agenda operativa. Todo se puede editar después.
          </p>

          {existing.length > 0 && (
            <div className="mt-4 space-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              <p>
                Estás creando una <span className="font-medium text-foreground">clínica nueva</span>
                , separada de{" "}
                <span className="font-medium text-foreground">
                  {existing.map((c) => c.name).join(", ")}
                </span>
                : empieza vacía, sin pacientes ni agenda.
              </p>
              <p>
                Si querías cambiar el nombre u otros datos de tu clínica, ve a{" "}
                <Link
                  to="/datos-de-la-clinica"
                  className="font-medium text-brand-700 underline underline-offset-4"
                >
                  Ajustes · Datos de la clínica
                </Link>
                .
              </p>
            </div>
          )}
        </header>

        <ol className="mb-8 flex flex-wrap gap-2">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                index === step
                  ? "border-brand bg-brand text-brand-foreground"
                  : index < step
                    ? "border-brand/30 bg-brand-soft text-brand-700"
                    : "border-border bg-card text-muted-foreground",
              )}
            >
              {index < step ? (
                <Check className="size-3" />
              ) : (
                <span className="font-medium">{index + 1}</span>
              )}
              {label}
            </li>
          ))}
        </ol>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {step === 0 && (
            <div className="space-y-5">
              <Field label="Nombre de la clínica" htmlFor="clinicName">
                <input
                  id="clinicName"
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder="Clínica Dental Esmalia"
                  className={inputClass}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Razón social (opcional)" htmlFor="legalName">
                  <input
                    id="legalName"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Identificación fiscal (opcional)" htmlFor="taxId">
                  <input
                    id="taxId"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="País" htmlFor="country">
                <select
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className={inputClass}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-xs text-muted-foreground">
                Moneda <span className="font-medium text-foreground">{countryConfig.currency}</span>{" "}
                · zona horaria{" "}
                <span className="font-medium text-foreground">{countryConfig.timezone}</span>
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <Field label="Nombre de la sucursal" htmlFor="branchName">
                <input
                  id="branchName"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Dirección" htmlFor="address">
                  <input
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Ciudad" htmlFor="city">
                  <input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field label="Teléfono" htmlFor="phone">
                  <input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Abre" htmlFor="opensAt">
                  <input
                    id="opensAt"
                    type="time"
                    value={opensAt}
                    onChange={(e) => setOpensAt(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Cierra" htmlFor="closesAt">
                  <input
                    id="closesAt"
                    type="time"
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium">Boxes / sillones</p>
                <div className="space-y-2">
                  {operatories.map((op, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        value={op}
                        aria-label={`Box ${index + 1}`}
                        onChange={(e) =>
                          setOperatories((prev) =>
                            prev.map((v, i) => (i === index ? e.target.value : v)),
                          )
                        }
                        className={inputClass}
                      />
                      <button
                        type="button"
                        aria-label={`Eliminar box ${index + 1}`}
                        onClick={() => setOperatories((prev) => prev.filter((_, i) => i !== index))}
                        className="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setOperatories((prev) => [...prev, `Box ${prev.length + 1}`])}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
                >
                  <Plus className="size-3.5" /> Agregar box
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="mb-4 text-sm text-muted-foreground">
                Selecciona las especialidades que atiende la clínica. Definen el color y la duración
                por defecto en la agenda.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SPECIALTY_PRESETS.map((s) => {
                  const active = selectedSpecialties.includes(s.name);
                  return (
                    <button
                      key={s.name}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelectedSpecialties((prev) =>
                          active ? prev.filter((n) => n !== s.name) : [...prev, s.name],
                        )
                      }
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                        active
                          ? "border-brand bg-brand-soft"
                          : "border-border bg-background hover:bg-secondary",
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {s.defaultDurationMin} min
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Agrega a los profesionales que tendrán columna en la agenda.
              </p>
              {professionals.map((p, index) => (
                <div key={index} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Profesional {index + 1}
                    </span>
                    {professionals.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Eliminar profesional ${index + 1}`}
                        onClick={() =>
                          setProfessionals((prev) => prev.filter((_, i) => i !== index))
                        }
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nombre completo" htmlFor={`pro-name-${index}`}>
                      <input
                        id={`pro-name-${index}`}
                        value={p.fullName}
                        onChange={(e) =>
                          setProfessionals((prev) =>
                            prev.map((v, i) =>
                              i === index ? { ...v, fullName: e.target.value } : v,
                            ),
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Correo (opcional)" htmlFor={`pro-email-${index}`}>
                      <input
                        id={`pro-email-${index}`}
                        type="email"
                        value={p.email}
                        onChange={(e) =>
                          setProfessionals((prev) =>
                            prev.map((v, i) => (i === index ? { ...v, email: e.target.value } : v)),
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="N° de registro (opcional)" htmlFor={`pro-lic-${index}`}>
                      <input
                        id={`pro-lic-${index}`}
                        value={p.licenseNumber}
                        onChange={(e) =>
                          setProfessionals((prev) =>
                            prev.map((v, i) =>
                              i === index ? { ...v, licenseNumber: e.target.value } : v,
                            ),
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Especialidad" htmlFor={`pro-spec-${index}`}>
                      <select
                        id={`pro-spec-${index}`}
                        value={p.specialtyName}
                        onChange={(e) =>
                          setProfessionals((prev) =>
                            prev.map((v, i) =>
                              i === index ? { ...v, specialtyName: e.target.value } : v,
                            ),
                          )
                        }
                        className={inputClass}
                      >
                        <option value="">Sin asignar</option>
                        {selectedSpecialties.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setProfessionals((prev) => [
                    ...prev,
                    {
                      fullName: "",
                      email: "",
                      licenseNumber: "",
                      specialtyName: "",
                      color: "#a8772c",
                    },
                  ])
                }
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
              >
                <Plus className="size-3.5" /> Agregar profesional
              </button>
            </div>
          )}

          {error && <p className="mt-5 text-xs text-destructive">{error}</p>}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || mutation.isPending}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-secondary disabled:opacity-40"
            >
              Atrás
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={!stepValid}
                className="rounded-lg border border-brand bg-transparent px-5 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12 disabled:opacity-40"
              >
                Continuar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  mutation.mutate();
                }}
                disabled={!stepValid || mutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-brand bg-transparent px-5 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12 disabled:opacity-40"
              >
                {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
                Finalizar configuración
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
