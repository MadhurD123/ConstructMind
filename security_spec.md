# Security Specification (Phase 0)

This document contains structural and authorization invariants for the Firebase setup safeguarding **ConstructMind AI**, along with the "Dirty Dozen" malicious payloads and authorization scenarios designed to compromise system integrity.

## 1. Data Invariants

1. **User Identity Invariant**: A user profile document `/users/{userId}` can only be created or modified if `userId` matches the authenticated `request.auth.uid`.
2. **Project Ownership Invariant**: A project `/projects/{projectId}` cannot exist without a valid `ownerId` that strictly matches `request.auth.uid`.
3. **Immutability Invariant**: A project's `ownerId` and `id` must be immutable after creation.
4. **Verified Access**: Users modified or reading non-own objects must be rejected.
5. **No Spoofing**: Users cannot update roles or spoof identities.

## 2. The "Dirty Dozen" Malicious Payloads

The following payloads represent illegal, spoofed, or poisoned data structures that must be strictly rejected by the Firestore rules:

### 1. User Spoofing Attack (PII Leak)
- **Path**: `/users/attacker_uid`
- **Action**: `create`
- **Payload**: `{ "uid": "victim_uid", "email": "victim@example.com", "createdAt": "request.time" }`
- **Reason to fail**: `uid` does not match the authenticated user `request.auth.uid`.

### 2. Project Ownership Hijack (Steal Project)
- **Path**: `/projects/project_123`
- **Action**: `update`
- **Payload**: `{ "ownerId": "attacker_uid" }`
- **Reason to fail**: Attempting to alter the immutable `ownerId` of a project of another owner.

### 3. Orphaned Project Insertion
- **Path**: `/projects/project_123`
- **Action**: `create`
- **Payload**: `{ "id": "project_123", "name": "Hack.ifc", "summary": {}, "uploadedAt": "request.time", "ownerId": "someone_else_uid" }`
- **Reason to fail**: `ownerId` in document body must match `request.auth.uid`.

### 4. Timestamp Fraud
- **Path**: `/projects/project_123`
- **Action**: `create`
- **Payload**: `{ "id": "project_123", "name": "Hack.ifc", "summary": {}, "uploadedAt": "2020-01-01T00:00:00Z", "ownerId": "current_user_uid" }`
- **Reason to fail**: `uploadedAt` must be set to the server timestamp `request.time`.

### 5. ID Poisoning Guard (Denial of Wallet)
- **Path**: `/projects/poisonsuperlongaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
- **Action**: `create`
- **Reason to fail**: Resource names (IDs) must correspond to standard UUID sizes and pattern validation.

### 6. PII Scraping / Direct Document Query without Ownership
- **Path**: `/projects/project_123`
- **Action**: `get` (By User B)
- **Reason to fail**: User B does not own `project_123` (lack of verification).

### 7. Global Projects Broad Reading (Blanket List)
- **Query**: `collection('projects')`
- **Action**: `list` (By User A)
- **Reason to fail**: Query lacks an ownership filter (`where("ownerId", "==", request.auth.uid)`). Safe-list query enforcer.

### 8. Maligning Summary Fields (Type Poisoning)
- **Path**: `/projects/project_123`
- **Action**: `create`
- **Payload**: `{ "id": "project_123", "name": "BIM.ifc", "summary": "not-an-object", "uploadedAt": "request.time", "ownerId": "current_user_uid" }`
- **Reason to fail**: `summary` must be a map/object representation.

### 9. Phantom Fields Injection
- **Path**: `/projects/project_123`
- **Action**: `create`
- **Payload**: `{ "id": "project_123", "name": "BIM.ifc", "summary": {}, "uploadedAt": "request.time", "ownerId": "current_user_uid", "isAdmin": true, "ghostField": "malicious" }`
- **Reason to fail**: Violates the exact properties structure configured in the schema.

### 10. Direct Writing into System Fields
- **Path**: `/users/user_123`
- **Action**: `update`
- **Payload**: `{ "role": "admin" }`
- **Reason to fail**: User profiles cannot self-assign privileged fields.

### 11. Blank Project File Name
- **Path**: `/projects/project_123`
- **Action**: `create`
- **Payload**: `{ "id": "project_123", "name": "", "summary": {}, "uploadedAt": "request.time", "ownerId": "current_user_uid" }`
- **Reason to fail**: Project title cannot be empty.

### 12. Deleting Other's Projects
- **Path**: `/projects/victim_project_123`
- **Action**: `delete` (By Attacker)
- **Reason to fail**: Attacker must not be authorized to delete other users' projects.

---

## 3. The Test Runner Spec

Test assertions logic translates to the rules enforcement defined in `/firestore.rules`.
