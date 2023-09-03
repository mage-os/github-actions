import { getMatrixForVersions } from "./get-matrix-for-versions";
import { getIndividualVersionsForProject } from "../versions/get-versions-for-project";

import latestJson from '../kind/latest.json';
import nightly from '../kind/nightly.json';
import { amendMatrixForNext } from "../nightly/get-next-version";
import { getDayBefore } from '../nightly/get-day-before';
import { getCurrentlySupportedVersions } from "../kind/get-currently-supported";

export const getMatrixForKind = (kind: string, versions = "") => {
    const project = "magento-open-source";
    
    switch(kind){
        case 'latest': 
          return getMatrixForVersions(latestJson);
        case 'currently-supported':
          return getMatrixForVersions(getCurrentlySupportedVersions(new Date()));
        case 'nightly':
          return amendMatrixForNext(getMatrixForVersions(nightly), 'https://upstream-mirror.mage-os.org', getDayBefore());
        case 'all':
          return getMatrixForVersions(Object.keys(getIndividualVersionsForProject(project)));
        case 'custom':
          return getMatrixForVersions(versions.split(","))
        default:
          throw new Error(`Unreachable kind: ${kind} discovered, please report to the maintainers.`);
      }
}