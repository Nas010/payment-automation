export type SetupStatus = "CLAIMED" | "WORKSPACE_CONNECTED" | "COMPLETE";

export type InstallationRecord = {
  ownerGoogleSub: string;
  ownerEmail: string;
  setupStatus: SetupStatus;
  createdAt: string;
  updatedAt: string;
};

export type GoogleOwnerIdentity = {
  googleSub: string;
  email: string;
};
