import type { ProjectScan } from '../../src/types/index';

export type PanelProject = ProjectScan & {
  version: string;
  localOnly: true;
};
