# Attack families and public fraud typologies

Each Fraudverse attack family is matched to a publicly documented fraud typology. All data
in Fraudverse is synthetic. The sources below describe the real-world typology; they do **not**
validate the numbers the simulator produces.

Every source here was opened and read on 16 November 2026. Where a source supports only part
of what a family does, that is stated. Nothing is cited that was not read.

| Family | Public typology | Source |
|---|---|---|
| `account_takeover` | Account takeover (ATO) | FBI IC3 alert I-112525-PSA, 25 Nov 2025 |
| `synthetic_identity` | Synthetic identity fraud | Federal Reserve, FedPayments Improvement |
| `card_testing` | Carding (validating stolen card data) | OWASP Automated Threats, OAT-001 |
| `velocity_burst` | Rapid movement of funds through new or thin accounts, money mules | FinCEN FIN-2024-Alert004; FinCEN FIN-2020-A003 |
| `ai_social_engineering` | Fraud using generative-AI media | FinCEN FIN-2024-Alert004 |
| `multi_step_takeover` | Account takeover, extended | FBI IC3 alert I-112525-PSA (partly) |

## What each source says, and how far the match goes

### account_takeover
- **Source:** FBI Internet Crime Complaint Center, alert I-112525-PSA, 25 November 2025.
  <https://www.ic3.gov/PSA/2025/PSA251125>
- **Says:** criminals "gain unauthorized access to the targeted online financial institution,
  payroll, or health savings account". The alert describes impersonating bank support to get
  login details and one-time passcodes, then logging in to the real site and starting a
  password reset, and then quickly wiring money to accounts the criminals control.
- **Match:** good. The family models a payment from a taken-over account: new device, low
  device trust, larger amount, possible location mismatch.

### synthetic_identity
- **Source:** Federal Reserve, FedPayments Improvement, "Synthetic Identity Fraud".
  <https://fedpaymentsimprovement.org/strategic-initiatives/payments-security/synthetic-identity-payments-fraud/>
- **Says:** synthetic identity fraud is "the use of a combination of personally identifiable
  information (PII) to fabricate a person or entity in order to commit a dishonest act for
  personal or financial gain."
- **Match:** partial. The simulator models only the *behaviour* of such an account (very new
  account, new payee, new device, gradual build-up). It does not model identity creation or
  document checks, which are the main way this fraud is detected in practice.

### card_testing
- **Source:** OWASP Automated Threat Handbook, OAT-001 Carding.
  <https://owasp.github.io/www-project-automated-threats-to-web-applications/assets/oats/EN/OAT-001_Carding>
- **Says:** "Multiple payment authorisation attempts to verify the validity of bulk stolen
  payment card data." Card details are tested against a merchant's payment process to find
  the valid ones.
- **Match:** good for the pattern the simulator uses: many small attempts in quick succession,
  a share of them failing authentication, often on a new device.
- **Not from the source:** the exact amounts (3 to 25 percent of the customer's average), the
  attempt rate and the failure share are modelling choices.

### velocity_burst
- **Sources:**
  - FinCEN alert FIN-2024-Alert004, 13 November 2024. It lists, among red flags, "Patterns of
    rapid transactions by a newly opened account or an account with little prior transaction
    history" and "withdrawing funds immediately after deposit".
    <https://www.fincen.gov/system/files/shared/FinCEN-Alert-DeepFakes-Alert508FINAL.pdf>
  - FinCEN advisory FIN-2020-A003, 7 July 2020, defines a money mule as "a person who transfers
    illegally acquired money on behalf of or at the direction of another."
    <https://www.fincen.gov/system/files/advisory/2020-07-07/Advisory_%20Imposter_and_Money_Mule_COVID_19_508_FINAL.pdf>
- **Match:** partial. Both documents support "rapid movement of money through an account" as a
  warning sign. Neither describes a specific payment rate. The family models the cash-out
  end of such a scheme: many ordinary-sized payments to new payees in a short time.

### ai_social_engineering
- **Source:** FinCEN alert FIN-2024-Alert004, 13 November 2024, which concerns "fraud schemes
  associated with the use of deepfake media created with generative artificial intelligence
  (GenAI) tools". <https://www.fincen.gov/system/files/shared/FinCEN-Alert-DeepFakes-Alert508FINAL.pdf>
- **Match:** partial. The alert is mainly about deepfakes defeating identity checks at account
  opening and access. The simulator models a different end of the same trend: a customer who
  is persuaded to authorise a payment to a new payee, so device and location look normal. That
  specific behaviour is a modelling choice and is not taken from the alert.
- **Not cited:** a definition of "authorised push payment" fraud from the UK FCA handbook was
  looked for, but its page could not be read, so it is not cited here.

### multi_step_takeover
- **Source:** the FBI alert above, which supports part of the sequence: credentials
  obtained, a password reset that locks the owner out, then a quick transfer out.
- **Match:** partial, and this is the least sourced family. The four-step order the simulator
  uses (account change, new payee added, small test payment, large transfer) and the gaps
  between steps (minutes to about an hour and a half) are **modelling assumptions**, not
  taken from a verified source. The "small test payment before the large one" step is in the
  spirit of card testing, but no source read for this project describes it for account takeover.
- **Representation:** the models only see payment features, so the account change is shown as a
  near-zero payment from a new device with a password-based login. Real systems would see it as
  a separate event.

## Seasonality is an assumption too

The seasonal month (weekend, month-end salary and festival-week behaviour) has **no verified
source** behind its numbers. The calendar and the size of each effect are assumptions made so
the policy can be tested against busy periods. See `docs/known-limitations.md`.

## Original attack families

`account_takeover`, `ai_social_engineering` and `synthetic_identity` were part of the project
before these additions. Only the sources above were checked for this document.
