import { GithubActionsMatrix, PackageMatrixVersion } from "./matrix-type";
import {getIndividualVersionsForProject, getCompositeVersionsForProject} from "../versions/get-versions-for-project";

/**
 * Computes the Github Actions Matrix for given versions of Magento
 */
export const getMatrixForVersions = (versions: string[]): GithubActionsMatrix => {
    const project = "magento-open-source"
    const knownVersions : Record<string, PackageMatrixVersion> = {
        ...getIndividualVersionsForProject(project), ...getCompositeVersionsForProject(project)
    }
    
    return versions.reduce((acc, current): GithubActionsMatrix => {
        if(knownVersions[current] === undefined){
            throw new Error("Unknown version while computing matrix");
        }

        return {
            magento: [...acc.magento, current],
            include: [...acc.include, knownVersions[current]]
        }
    }, {magento: [], include: []});
}