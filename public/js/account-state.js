// One place that decides what state an account is in (W27a).
// A person is in exactly one state. When several things apply, the first one wins:
//   blocked   the owner (or the automatic rule) blocked him
//   deleting  he asked to delete his account and the 24-hour countdown is running
//   pending   a driver the owner has not approved yet (or set back to pending)
//   active    everything else (an approved driver, or a student)
export const STATE_LABELS = {
  active: "Active",
  pending: "Pending",
  blocked: "Blocked",
  deleting: "Deleting",
  none: "No profile"
};

export function accountState(profile, driver) {
  if (!profile) return "none";
  if (profile.blocked === true) return "blocked";
  if (profile.deleteRequestedAt) return "deleting";
  if (profile.role === "driver" && !(driver && driver.approvalStatus === "approved")) return "pending";
  return "active";
}
