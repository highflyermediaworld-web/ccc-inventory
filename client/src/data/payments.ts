/**
 * Ways customers can pay CPulls Cards.
 *
 * Used by the storefront ("Ways to pay" section, Buy confirmation, FAQ) and the
 * admin register (show-the-customer pay code). Update handles/links here.
 * QR images live in client/public/pay/ and encode exactly the `link` below.
 */
export type PaymentMethodId = "zelle" | "venmo" | "cashapp" | "paypal";

export type PaymentOption = {
  id: PaymentMethodId;
  name: string;
  /** What the customer searches for / sees in their app */
  handle: string;
  /** Short note shown under the handle */
  note: string;
  /** Deep link — opens the app or web pay page */
  link: string;
  /** Build a link that pre-fills the amount where the app supports it */
  linkWithAmount?: (amount: number) => string;
  /** Static QR (encodes `link`) */
  qr: string;
  /** Brand accent */
  color: string;
  /** Admin register enum value (Payments page / transactions ledger) */
  registerValue: "Zelle" | "Venmo" | "CashApp" | "PayPal";
};

export const PAYMENT_OPTIONS: PaymentOption[] = [
  {
    id: "zelle",
    name: "Zelle",
    handle: "Dreamers Innovation Co LLC",
    note: "Business account · no fees · send from your bank app",
    link: "https://enroll.zellepay.com/qr-codes?data=ewogICJuYW1lIiA6ICJEUkVBTUVSUyBJTk5PVkFUSU9OIENPIExMQyIsCiAgImFjdGlvbiIgOiAicGF5bWVudCIsCiAgInRva2VuIiA6ICJjaHJpc2NvbGxlY3RzY28iCn0=",
    qr: "/pay/zelle.png",
    color: "#6d1ed4",
    registerValue: "Zelle",
  },
  {
    id: "venmo",
    name: "Venmo",
    handle: "@Christian-Young-74",
    note: "Friends & family",
    link: "https://venmo.com/code?user_id=2788079664365568722",
    linkWithAmount: (amount) => `https://venmo.com/Christian-Young-74?txn=pay&amount=${amount.toFixed(2)}`,
    qr: "/pay/venmo.png",
    color: "#008cff",
    registerValue: "Venmo",
  },
  {
    id: "cashapp",
    name: "Cash App",
    handle: "$Sasorilegend630",
    note: "Instant",
    link: "https://cash.app/$Sasorilegend630",
    linkWithAmount: (amount) => `https://cash.app/$Sasorilegend630/${amount.toFixed(2)}`,
    qr: "/pay/cashapp.png",
    color: "#00d632",
    registerValue: "CashApp",
  },
  {
    id: "paypal",
    name: "PayPal",
    handle: "Christian Young",
    note: "Scan or tap to pay",
    link: "https://www.paypal.com/qrcodes/p2pqrc/DN64YAVG8FHAG",
    qr: "/pay/paypal.png",
    color: "#003087",
    registerValue: "PayPal",
  },
];

export const PAYMENT_NAMES = PAYMENT_OPTIONS.map((p) => p.name); // ["Zelle", "Venmo", "Cash App", "PayPal"]

export function paymentByRegisterValue(v: string): PaymentOption | undefined {
  return PAYMENT_OPTIONS.find((p) => p.registerValue === v);
}
