# Sale view in Structure Studio

**Why:** Studio never shows a structure beating "buy directly", because it ignores the exit, where an SPV pays off: the next buyer buys shares at 0.5% stamp duty instead of paying full SDLT on the properties.

**Approaches considered**
1. "25 years + sale" horizon folding a sale price uplift into total cost, plus an ATED relief toggle.
2. Separate "On sale" view showing what each option saves on sale (picked: user wants the saving shown, not total cost).
3. ATED relief toggle only (no sale story).

**Design**
- `lib/horizon.ts`: new `"sale"` horizon and `saleSaving(result, option)`. Saving = next buyer's direct SDLT (proxy: option A's purchase SDLT rows, today's prices) minus the stamp duty on that option's sale (engine `exit` rows; A has none, so its saving is 0).
- Studio: "On sale" button in "Compare over". Cards show the saving (most saved is highlighted). The bottom bar shows direct SDLT, duty on this sale and the saving. The side panel shows a savings chart and table.
- Non-goals: price growth, CGT, ATED relief, PDF export.
