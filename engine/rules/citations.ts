export const AS_OF = "2026-27";
export const CITE = {
  sdlt: "https://www.gov.uk/stamp-duty-land-tax",
  shares: "https://www.gov.uk/hmrc-internal-manuals/stamp-taxes-shares-manual/stsm013010",
  ated: "https://www.gov.uk/guidance/annual-tax-on-enveloped-dwellings-the-basics",
  /** 2% surcharge on residential SDLT for non-UK resident buyers, incl. UK close companies controlled by non-residents. */
  sdltNonUk: "https://www.gov.uk/guidance/rates-of-stamp-duty-land-tax-for-non-uk-residents",
  /** Non-UK residents pay UK tax on gains from UK land, including indirect disposals. */
  nrcgt: "https://www.gov.uk/guidance/capital-gains-tax-for-non-residents-uk-residential-property",
  /** Entry (20% lifetime) charge and trust IHT overview. */
  trustsIht: "https://www.gov.uk/guidance/trusts-and-inheritance-tax",
  /** Ten-year anniversary (principal) charge, up to 6%. */
  trustTenYear: "https://www.gov.uk/hmrc-internal-manuals/inheritance-tax-manual/ihtm42081",
  /** 40% death rate above the nil-rate band. */
  ihtDeath: "https://www.gov.uk/inheritance-tax",
} as const;
