export type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "birth_grant"
  | "api_cost";

export interface Transaction {
  id: string;
  agentId: string;
  amount: string;
  type: TransactionType;
  description: string;
  balanceAfter: string;
  referenceId: string | null;
  createdAt: string;
}
