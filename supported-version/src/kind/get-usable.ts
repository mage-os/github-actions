import { PackageMatrixVersion } from '../matrix/matrix-type';
import { getIndividualVersionsForProject } from "../versions/get-versions-for-project";
import semver from 'semver';

export const getUsableVersions = (project: string): string[] => {
    const allVersions = getIndividualVersionsForProject(project)
    return Object.entries(<Record<string,PackageMatrixVersion>>allVersions)
        .filter(([key, value]) => {
            return value.composer && semver.gte(value.composer.toString(), '2.0.0');
        })
        .map(([key, value]) => key);
}