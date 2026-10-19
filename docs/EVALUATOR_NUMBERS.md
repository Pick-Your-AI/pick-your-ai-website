# Numeric values in compatibility evaluation

The website interprets the frozen research rules DSL. Its authority is the
[operator and operand contract](../contracts/v1/docs/DEPENDENCIES.md), together with the
[pinned import record](../contracts/PROVENANCE.json). Numeric equality uses decimal
normalization; ordering accepts numeric operands and produces `unknown` for incompatible
values. This implementation correction preserves those rules, all vendored files, and the
existing cost and price arithmetic.

## Numeric representation

`src/domain/evaluation-number.ts` represents an evaluator number as an integer coefficient
and a decimal exponent. Comparisons, context-token addition, selected VRAM addition and
multiplication, and minimum selected VRAM use that representation. They preserve the
decimal value without rounding it to the money helper's twelve-place scale.

After exact context addition, a result that round-trips through a finite numeric primitive
without changing value retains that primitive representation. This preserves membership in
allowed context-count lists. An unrepresentable sum stays exact and does not match a
differently rounded list member.

The interpreter admits finite JavaScript numbers using their decimal spelling, including
scientific notation. A numeric **string** still has to match the complete frozen contract
decimal format: a nonnegative integer without redundant leading zeros, optionally followed
by one to twelve fractional digits. Thus numeric `1e-13` is supported while the strings
`"1e-13"`, `"-1"`, and `"0.0000000000001"` remain nonnumeric. Booleans, nulls and JSON
objects remain nonnumeric for ordering.

Internal exact numbers have a private runtime brand. An ordinary JSON value cannot gain numeric
authority by providing a field such as `__scaled`, `coefficient`, or `exponent`. In
particular, `{"__scaled":"1"}` produces an unknown ordering result instead of a passed
comparison. A nested object with non-callable `toString` and `valueOf` fields also produces
an unknown result; evaluation does not attempt to coerce that object into a primitive.

The existing finding, summary and readiness rules still apply. An unknown assertion with
`on_unknown: "block"` yields an indeterminate report and blocked deployment readiness. A
passed compatibility rule supplies no independent deployment approval.

## Regression scope

The numeric additions to
[`tests/unit/evaluator-parity.test.ts`](../tests/unit/evaluator-parity.test.ts) check
schema-valid complete builds, catalogs, rulesets and reports. They assert the finding,
summary, aggregate result, readiness and unchanged inputs, then compare the complete report
with the unchanged vendored Python reference when Python is available. CI supplies Python.

Representative cases include:

| Expression or metric                                       | Required result |
| ---------------------------------------------------------- | --------------- |
| `1e-13 > 0` and `-1e-13 < 0`                               | Pass            |
| `1e-13 == 2e-13`                                           | Fail            |
| `1e21 == "1000000000000000000000"`                         | Pass            |
| Smallest positive finite JavaScript number `> 0`           | Pass            |
| List `[1e-13]` contains `2e-13`                            | Fail            |
| `{"__scaled":"1"} > 0`                                     | Unknown         |
| Three devices with `1e-13` GB each `> 2e-13` GB            | Pass            |
| Context count `9007199254740991 + 2 == "9007199254740993"` | Pass            |

These are synthetic interpreter cases. They are not real hardware specifications or price
claims. The original published example report and all seven existing scenario comparisons
remain unchanged and continue to run.

## Remaining interpretation boundaries

The evaluator receives already decoded JavaScript values. It cannot recover a JSON number
token that an earlier decoder rounded, overflowed or underflowed. Preserving every original
wire token, defining a successor numeric profile, and adopting that profile across clients
remain decisions for the canonical
[Research #40 contract route](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/40).

The frozen operator table describes scalar equality and list operations without explicitly
choosing Python's Boolean/integer aliases or all nested-container equality details. The
historical reference comparison in
[Android #49](https://github.com/Pick-Your-AI/pick-your-ai-android/issues/49#issuecomment-6266380541)
records differences such as `eq(true, 1)` and `contains([1], true)`. Those host-language
differences are separate from the numeric correction here. This change preserves the
existing Boolean and nested-container decisions; it does not declare the Python fallback
to be additional contract policy or claim universal interpreter parity.

The fixed-scale money formatter and cost estimator retain their existing behavior. This
document establishes no new real-price, resource-calibration, Android evaluator, native
device or release acceptance.
