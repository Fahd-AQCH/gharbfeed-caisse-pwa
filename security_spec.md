# Security Specification - GharbFeed v1.2

## Data Invariants
- An `Operation` cannot exist without a valid `userId` (the creator).
- `StockMovement` records must be tied to a `productId` and an `operationId` (if applicable).
- `OperationItem` must always reference an existing `Operation`.
- `stockActual` in `Product` must be strictly validated during updates to match the sum of movements (ideally, but tricky in rules; at least it must be numeric).
- Sensitive fields like `finalTotal` must be calculated correctly (though rules cannot do complex math easily, we enforce types and ownership).
- `roles` are strictly read-only for non-admins.

## The "Dirty Dozen" Payloads (Denial Tests)
1. Creating an Operation with a different `userId` than the authenticated user.
2. Modifying the `roleId` of a User by the user themselves.
3. Deleting an `AuditLog` entry.
4. Creating a `Product` with a negative `stockActual` (if we want to forbid that).
5. Updating an `Operation` status from 'validated' to 'draft' (terminal state locking).
6. Injecting a 2MB string into `Product` description.
7. Listing all `audit_logs` as a Caissier.
8. Modifying `createdAt` during an update.
9. Creating an `OperationItem` for a non-existent `Operation` (via ID Poisoning).
10. Spoofing an admin role by creating a user profile with `roleId: 'admin'` without being an admin.
11. Bypassing `email_verified` check (if strictly required).
12. Updating `finalTotal` in a validated operation.

## Role Definitions (to be stored in /roles)
- `admin`: Full access.
- `cashier`: Read `products`, `clients`, `units`, `categories`. Write `operations`, `operation_items`, `clients`, `stock_movements` (vente type).
- `stock_manager`: Read everything. Write `products` (stock part), `stock_movements`.
- `supervisor`: Read everything. Write `operations` (cancel/validate).
