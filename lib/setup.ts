/**
 * "Set up this structure": the steps, deadlines and roles needed to put an option in place,
 * plus a plain-text brief to send to advisers. Deterministic; every step cites its gov.uk page.
 */
import type { Assumptions as EngineAssumptions, EngineResult, Flag, Investor, OptionId, Packet, Stage, Structure } from "@/contracts";
import { gbp } from "@/lib/api";
import { assumptionsSentence } from "@/lib/horizon";

export type RoleId =
  | "conveyancer"
  | "property_tax"
  | "corporate"
  | "accountant"
  | "fund_lawyer"
  | "fund_admin"
  | "private_client"
  | "trustee";

export const ROLE_LABEL: Record<RoleId, string> = {
  conveyancer: "Property solicitor",
  property_tax: "Property tax adviser",
  corporate: "Company formation",
  accountant: "Accountant",
  fund_lawyer: "Fund lawyer",
  fund_admin: "Fund administrator and trustee",
  private_client: "Trusts and inheritance tax solicitor",
  trustee: "Professional trustee",
};

export interface SetupStep {
  id: string;
  title: string;
  detail: string;
  roles: RoleId[];
  deadline?: string;
  source?: { label: string; url: string };
}

const GOV = {
  sdltReturn: "https://www.gov.uk/guidance/stamp-duty-land-tax-online-and-paper-returns",
  landRegistry: "https://www.gov.uk/registering-land-or-property-with-land-registry",
  company: "https://www.gov.uk/limited-company-formation",
  psc: "https://www.gov.uk/guidance/people-with-significant-control-pscs",
  corpTax: "https://www.gov.uk/corporation-tax",
  atedReturn: "https://www.gov.uk/guidance/annual-tax-on-enveloped-dwellings-returns",
  trs: "https://www.gov.uk/guidance/register-a-trust-as-a-trustee",
  iht100: "https://www.gov.uk/government/publications/inheritance-tax-inheritance-tax-account-iht100",
  rif: "https://www.gov.uk/guidance/submit-an-entry-notification-for-a-reserved-investor-fund",
  cgtElection: "https://www.gov.uk/guidance/elect-a-qualifying-company-for-tax-exemption-on-uk-capital-gains",
} as const;

export function rolesFor(option: OptionId): RoleId[] {
  const base: RoleId[] = ["conveyancer", "property_tax"];
  if (option === "A") return base;
  const company: RoleId[] = [...base, "corporate", "accountant"];
  if (option === "B") return company;
  if (option === "C") return [...base, "accountant", "fund_lawyer", "fund_admin"];
  return [...company, "private_client", "trustee"];
}

/** Ordered steps for one option, tailored to its structure and the engine's result. */
export function setupSteps(option: OptionId, structure: Structure | undefined, result: EngineResult | null): SetupStep[] {
  const rows = result?.rows.filter((r) => r.option === option) ?? [];
  const sum = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((s, r) => s + r.amount_gbp, 0);
  const sdlt = sum((r) => r.tax.startsWith("SDLT"));
  const ated = sum((r) => r.tax === "ATED");
  const entry = sum((r) => r.tax === "IHT_ENTRY");
  const fund = structure?.nodes.find((n) => n.kind === "fund");
  const spv = structure?.nodes.find((n) => n.kind === "company")?.label ?? "PropCo Ltd";
  // C: the fund owns the properties directly, so there is no company to set up.
  const hasCompany = option === "B" || option === "D";
  const buyerName =
    option === "A" ? (structure?.nodes.find((n) => n.kind === "investor")?.label ?? "the buyer") : option === "C" ? `the ${fund?.label ?? "fund"}'s trustee` : spv;

  const steps: SetupStep[] = [];

  if (option === "D") {
    steps.push({
      id: "trust-deed",
      title: "Settle the discretionary trust",
      detail: "Draft the trust deed, appoint trustees and agree a letter of wishes before any property is bought.",
      roles: ["private_client", "trustee"],
    });
  }
  if (option === "C") {
    const isRif = fund?.fund_type === "RIF";
    steps.push(
      isRif
        ? {
            id: "fund-rif",
            title: "Set up the Reserved Investor Fund",
            detail: "Form the RIF as a UK co-ownership scheme with an authorised operator and depositary, then notify HMRC of entry.",
            roles: ["fund_lawyer", "fund_admin"],
            source: { label: "Reserved Investor Fund entry notification", url: GOV.rif },
          }
        : {
            id: "fund-jput",
            title: "Set up the Jersey Property Unit Trust",
            detail: "Appoint a Jersey trustee and administrator, constitute the unit trust and admit investors under the Jersey fund regime.",
            roles: ["fund_lawyer", "fund_admin"],
          },
    );
  }
  if (hasCompany) {
    steps.push(
      {
        id: "incorporate",
        title: `Incorporate ${spv}`,
        detail: "Register the company at Companies House with its directors, shareholders and registered office.",
        roles: ["corporate"],
        source: { label: "Set up a limited company", url: GOV.company },
      },
      {
        id: "psc",
        title: "Record people with significant control",
        detail:
          option === "D"
            ? "The trustees are registrable as controlling the company; record them on the PSC register."
            : "Record the owner of more than 25% of shares or votes on the PSC register.",
        roles: ["corporate"],
        source: { label: "People with significant control", url: GOV.psc },
      },
    );
  }
  if (option === "D") {
    steps.push({
      id: "settle",
      title: `Transfer ${spv} into the trust`,
      detail: `Settle the company shares into the trust. The engine estimates an entry charge of ${gbp(entry)}; report it on form IHT100.`,
      roles: ["private_client"],
      source: { label: "Inheritance Tax account (IHT100)", url: GOV.iht100 },
    });
  }
  steps.push(
    {
      id: "conveyance",
      title: `Buy the properties in ${buyerName}'s name`,
      detail: "Exchange and complete on each lot together, so they are treated as linked transactions where the seller is the same.",
      roles: ["conveyancer"],
    },
    {
      id: "sdlt",
      title: "File the SDLT return and pay",
      detail: `The engine estimates ${gbp(sdlt)} of stamp duty land tax across the packet.`,
      roles: ["conveyancer", "property_tax"],
      deadline: "Within 14 days of completion",
      source: { label: "SDLT returns", url: GOV.sdltReturn },
    },
    {
      id: "land-registry",
      title: "Register the titles with HM Land Registry",
      detail: `Register ${buyerName} as owner of each title.`,
      roles: ["conveyancer"],
      source: { label: "Registering land or property", url: GOV.landRegistry },
    },
  );
  if (hasCompany) {
    steps.push({
      id: "corp-tax",
      title: `Register ${spv} for Corporation Tax`,
      detail: "Tell HMRC the company is active and set up its accounting period.",
      roles: ["accountant"],
      source: { label: "Corporation Tax", url: GOV.corpTax },
    });
  }
  // With rental-business relief the ATED rows are £0, but a relief declaration return is still due.
  if (rows.some((r) => r.tax === "ATED")) {
    steps.push({
      id: "ated",
      title: "File the ATED return",
      detail:
        ated > 0
          ? `Homes over £500,000 held by a company are in ATED. The engine estimates ${gbp(ated)} a year; a property-rental-business relief claim would reduce this but still needs a return.`
          : "Homes over £500,000 held by a company are in ATED. With property-rental-business relief the charge is £0, but a relief declaration return is still needed each year.",
      roles: ["property_tax", "accountant"],
      deadline: "By 30 April each year",
      source: { label: "ATED returns", url: GOV.atedReturn },
    });
  }
  if (option === "C" && fund?.fund_type === "JPUT") {
    steps.push({
      id: "jput-election",
      title: "Make the JPUT tax election",
      detail: "Choose the transparency election (all investors consent) or the exemption election for the fund's UK property gains.",
      roles: ["fund_lawyer", "property_tax"],
      deadline: "Within 12 months of the first acquisition",
      source: { label: "Elect for exemption on UK capital gains", url: GOV.cgtElection },
    });
  }
  if (option === "D") {
    steps.push({
      id: "trs",
      title: "Register the trust with HMRC",
      detail: "Register on the Trust Registration Service and keep it updated each year.",
      roles: ["trustee", "private_client"],
      deadline: "Within 90 days of the trust becoming liable for tax",
      source: { label: "Register a trust as a trustee", url: GOV.trs },
    });
    const ten = sum((r) => r.tax === "IHT_TEN_YEAR");
    steps.push({
      id: "ten-year",
      title: "Diary the 10-year charge",
      detail: `The trust pays up to 6% every 10 years. The engine estimates ${gbp(ten)} at today's values.`,
      roles: ["trustee"],
      deadline: "Each 10th anniversary of the trust",
    });
  }
  return steps;
}

const STAGE_WORDS: Record<Stage, string> = {
  acquire: "On purchase",
  hold: "Each year",
  exit: "On sale",
  ten_year: "Every 10 years",
  death: "On death, family's share if held personally (comparison)",
};

/** Plain-text brief an investor can paste into an email to advisers. */
export function adviserBrief(args: {
  option: OptionId;
  packet: Packet;
  structure: Structure | undefined;
  result: EngineResult | null;
  investors: Investor[];
  steps: SetupStep[];
  /** The assumptions the engine ran with; stated in the brief so advisers read the figures on the same basis. */
  assumptions: EngineAssumptions;
}): string {
  const { option, packet, structure, result, investors, steps, assumptions } = args;
  const totals = result?.totals[option] ?? {};
  const flags: Flag[] = result?.flags.filter((f) => f.option === option) ?? [];
  const chain = structure?.nodes.filter((n) => n.kind !== "property").map((n) => n.label).join(" → ");
  const lines = [
    `Subject: Setting up option ${option}: ${structure?.name ?? ""}`,
    "",
    "Hello,",
    "",
    `We are looking to acquire ${packet.items.length} UK properties (${gbp(packet.totals.price_gbp)} in total) and would like help putting the structure below in place.`,
    "",
    `Investors: ${investors.map((i) => `${i.label} (${i.pct}%)`).join(", ") || "to be confirmed"}`,
    `Structure: ${chain ? `${chain} → properties` : structure?.name}`,
    "",
    "Properties:",
    ...packet.items.map((p) => `- ${p.address}${p.price_gbp ? `, ${gbp(p.price_gbp.value)}` : ""}`),
    "",
    "Our estimated tax costs (please confirm):",
    ...(Object.entries(totals) as [Stage, number][]).map(([s, v]) => `- ${STAGE_WORDS[s]}: ${gbp(v)}`),
    assumptionsSentence(assumptions),
    "",
    "Steps we expect:",
    ...steps.map((s, i) => `${i + 1}. ${s.title}${s.deadline ? ` (${s.deadline.toLowerCase()})` : ""}`),
  ];
  const review = flags.filter((f) => f.severity === "review");
  if (review.length) lines.push("", "Points we need your advice on:", ...review.map((f) => `- ${f.message}`));
  lines.push("", "Estimates from Structure Studio. Decision support, not tax advice.");
  return lines.join("\n");
}
