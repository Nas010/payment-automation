import { bangkokDateKey } from "@/lib/date";
import { runtimeConfig } from "@/lib/runtime-config";
import { appendAudit, listPayments, type PaymentAuditInput, type PaymentRecord } from "@/lib/sheets/payments";
import {
  isDeliverableDueLinePayment,
  sendDueLinePaymentRequests,
  type SendDueLinePaymentRequestsResult,
} from "./due-payments";

export type PostConnectionDeliveryDependencies = {
  baseUrl: string;
  listPayments: () => Promise<PaymentRecord[]>;
  appendAudit: (record: PaymentAuditInput) => Promise<void>;
  sendDueLinePaymentRequests: (options: {
    baseUrl: string;
    today: string;
    paymentIds: string[];
  }) => Promise<SendDueLinePaymentRequestsResult>;
};

export type PostConnectionDeliveryResult = {
  paymentIds: string[];
  selectionFailed: boolean;
  delivery: SendDueLinePaymentRequestsResult | null;
};

function isInitialPayment(payment: PaymentRecord): boolean {
  return payment.payment_type === "ONE_TIME" || payment.installment_number === "1";
}

export function selectDueInitialPaymentsAfterLineConnection(
  payments: readonly PaymentRecord[],
  { clientId, today }: { clientId: string; today: string },
): string[] {
  return payments
    .filter((payment) => payment.client_id === clientId && isInitialPayment(payment) && isDeliverableDueLinePayment(payment, today))
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.payment_id.localeCompare(right.payment_id))
    .map((payment) => payment.payment_id);
}

async function runtimeDependencies(): Promise<PostConnectionDeliveryDependencies> {
  const config = await runtimeConfig();
  return { baseUrl: config.publicBaseUrl, listPayments, appendAudit, sendDueLinePaymentRequests };
}

async function auditSelectionFailure(dependencies: PostConnectionDeliveryDependencies, clientId: string): Promise<void> {
  try {
    await dependencies.appendAudit({
      paymentId: "",
      clientId,
      action: "LINE_POST_CONNECT_DELIVERY_SELECTION_FAILED",
      previousStatus: "",
      newStatus: "FAILED_RETRYABLE",
      reason: "Post-connection payment selection failed",
      source: "LINE_CONNECT",
      metadata: JSON.stringify({ clientId, reasonCode: "PAYMENT_SELECTION_FAILED" }),
    });
  } catch {}
}

export async function deliverDueInitialPaymentsAfterLineConnection(
  { clientId, today = bangkokDateKey() }: { clientId: string; today?: string },
  injectedDependencies?: PostConnectionDeliveryDependencies,
): Promise<PostConnectionDeliveryResult> {
  const dependencies = injectedDependencies ?? await runtimeDependencies();
  let payments: PaymentRecord[];
  try {
    payments = await dependencies.listPayments();
  } catch {
    await auditSelectionFailure(dependencies, clientId);
    return { paymentIds: [], selectionFailed: true, delivery: null };
  }

  const paymentIds = selectDueInitialPaymentsAfterLineConnection(payments, { clientId, today });
  if (!paymentIds.length) return { paymentIds, selectionFailed: false, delivery: null };
  const delivery = await dependencies.sendDueLinePaymentRequests({ baseUrl: dependencies.baseUrl, today, paymentIds });
  return { paymentIds, selectionFailed: false, delivery };
}
