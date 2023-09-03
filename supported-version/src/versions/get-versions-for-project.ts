import {validateProject} from "../project/validate-projects";

const individual = {
    'mage-os': require('./mage-os/individual.json'),
    'magento-open-source': require('./magento-open-source/individual.json')
}

const composite = {
    'mage-os': require('./mage-os/composite.json'),
    'magento-open-source': require('./magento-open-source/composite.json')
}

export const getIndividualVersionsForProject = (project: string): object => {
    validateProject(<any>project)
    if (individual[project] === undefined) {
        throw new Error(
            `Project "${project}" has no individual version specifications`
        )
    }
    
    return individual[project]
}

export const getCompositeVersionsForProject = (project: string): object => {
    validateProject(<any>project)
    if (composite[project] === undefined) {
        throw new Error(
            `Project "${project}" has no composite version specifications`
        )
    }

    return composite[project]
}