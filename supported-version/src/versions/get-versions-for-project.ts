import {Project} from "../project/projects";

const individual = {
    'magento-open-source': require('./magento-open-source/individual.json')
}

const composite = {
    'magento-open-source': require('./magento-open-source/composite.json')
}

export const getIndividualVersionsForProject = (project: Project): object => {
    if (individual[project] === undefined) {
        throw new Error(
            `Project "${project}" has no individual version specifications`
        )
    }
    
    return individual[project]
}

export const getCompositeVersionsForProject = (project: Project): object => {
    if (composite[project] === undefined) {
        throw new Error(
            `Project "${project}" has no composite version specifications`
        )
    }

    return composite[project]
}