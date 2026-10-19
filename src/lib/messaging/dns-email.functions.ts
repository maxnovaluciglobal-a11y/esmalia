import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  calcularAprobado,
  esDominioValido,
  evaluarDkim,
  evaluarDmarc,
  evaluarSpf,
  normalizarDominio,
  type DnsCheckResult,
  type DnsVerification,
} from "@/lib/messaging/dns-email";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Consulta real de los registros de autenticación de email vía DNS-over-HTTPS.
 * Se ejecuta en el servidor para evitar restricciones del navegador. Exige
 * autenticación y clinicId como cinturón contra uso anónimo — antes era el
 * único endpoint sin middleware y se prestaba a DoH-resolver gratuito y DoS.
 */
export const verificarDnsEmail = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        domain: z.string().trim().max(253),
        dkimSelector: z.string().trim().max(63).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<DnsVerification> => {
    const domain = normalizarDominio(data.domain);
    const selector = data.dkimSelector.replace(/[^A-Za-z0-9._-]/g, "") || "default";

    if (!esDominioValido(domain)) {
      throw new Error("Introduce un dominio válido, por ejemplo tuclinica.com");
    }

    const inicio = Date.now();

    async function txt(nombre: string): Promise<string[]> {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nombre)}&type=TXT`;
      const respuesta = await fetch(url, { headers: { accept: "application/dns-json" } });
      if (!respuesta.ok) {
        throw new Error(`No se pudo consultar DNS para ${nombre} (HTTP ${respuesta.status}).`);
      }
      const json = (await respuesta.json()) as { Answer?: { type: number; data: string }[] };
      return (json.Answer ?? [])
        .filter((a) => a.type === 16)
        .map((a) =>
          a.data
            .split(/"\s+"/)
            .map((parte) => parte.replace(/^"|"$/g, ""))
            .join("")
            .trim(),
        )
        .filter(Boolean);
    }

    const dkimName = `${selector}._domainkey.${domain}`;
    const dmarcName = `_dmarc.${domain}`;

    const [spfRecords, dkimRecords, dmarcRecords] = await Promise.all([
      txt(domain),
      txt(dkimName),
      txt(dmarcName),
    ]);

    const results: DnsCheckResult[] = [
      evaluarSpf(domain, spfRecords),
      evaluarDkim(dkimName, dkimRecords),
      evaluarDmarc(dmarcName, dmarcRecords),
    ];

    return {
      domain,
      dkimSelector: selector,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - inicio,
      results,
      aprobado: calcularAprobado(results),
    };
  });
