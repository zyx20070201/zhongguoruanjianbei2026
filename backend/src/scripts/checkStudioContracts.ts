import { runStudioContractFixtures } from '../services/studio/contractFixtures';

const result = runStudioContractFixtures();
console.log(JSON.stringify(result, null, 2));
