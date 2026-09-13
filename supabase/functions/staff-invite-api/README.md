# Staff invite API

Owner-issued one-time VK onboarding. Invite codes are returned once to the owner, stored only as SHA-256 hashes, expire after one hour, and are consumed atomically by `redeem_staff_invite`.

The database trigger blocks direct transition from an unlinked staff identifier to a numeric VK ID unless it occurs inside the invite redemption RPC. This prevents the legacy phone-only onboarding path from claiming a staff card.
