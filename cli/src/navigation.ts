export type NavigationRequest =
  | {
      kind: 'OPEN_BRANCH';
      objectName: string;
      branchName: string;
      autoInspect?: boolean;
    };


