export type GoogleWorkspaceConnection = {
  refreshToken: string;
  accountGoogleSub: string;
  accountEmail: string;
  spreadsheetId: string;
  spreadsheetName: string;
  spreadsheetUrl: string;
  folderId: string;
  folderName: string;
  folderUrl: string;
  validatedAt: string;
};

export type PendingGoogleWorkspaceConnection = Pick<GoogleWorkspaceConnection, "refreshToken" | "accountGoogleSub" | "accountEmail">
  & Partial<Pick<GoogleWorkspaceConnection, "spreadsheetId" | "spreadsheetName" | "spreadsheetUrl" | "folderId" | "folderName" | "folderUrl">>;
