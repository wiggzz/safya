const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const log = require('loglevel');
const { promisifyAll } = require('bluebird');
const uploadPerfLambda = require('./perf-lambda/upload');
log.setLevel('debug');

AWS.config.region = 'us-east-1';

const cloudformation = promisifyAll(new AWS.CloudFormation());
const s3 = promisifyAll(new AWS.S3());

const E2E_STACK_NAME = 'safya-e2e-tests';
const PERF_STACK_NAME = 'safya-perf-tests';

const deployE2EStack = async () => {
  const STACK_NAME = E2E_STACK_NAME;
  const CHANGE_SET_NAME = 'safya-e2e-tests-changeset';

  const TemplateBody = fs.readFileSync(path.resolve(__dirname, path.join('..','src','stack.yml')), 'utf8');

  const shouldUpdateStack = await stackIsUpdatable(STACK_NAME);

  log.debug('creating changeset');
  const changeSet = await cloudformation.createChangeSetAsync({
    StackName: STACK_NAME,
    ChangeSetName: CHANGE_SET_NAME,
    ChangeSetType: shouldUpdateStack ? 'UPDATE' : 'CREATE',
    TemplateBody,
    Capabilities: ['CAPABILITY_IAM'],
  });

  if (await changeSetReadyAndWillProduceChanges(STACK_NAME, CHANGE_SET_NAME)) {
    log.debug('executing changeset');
    await cloudformation.executeChangeSetAsync({
      StackName: STACK_NAME,
      ChangeSetName: CHANGE_SET_NAME
    });

    await cloudformation.waitForAsync(shouldUpdateStack ? 'stackUpdateComplete' : 'stackCreateComplete', {
      StackName: STACK_NAME
    });
  } else {
    log.debug('deleting change set');
    await cloudformation.deleteChangeSet({
      StackName: STACK_NAME,
      ChangeSetName: CHANGE_SET_NAME
    });
  }

  return await e2eStackPhysicalIds(STACK_NAME);
};

const describeE2EStack = () => {
  return e2eStackPhysicalIds(E2E_STACK_NAME);
}

const e2eStackPhysicalIds = async (stackName) => {
  const { Stacks } = await cloudformation.describeStacksAsync({
    StackName: stackName
  });

  const partitionsTable = outputForStackWithOutputKey(Stacks[0], 'PartitionsTableName');
  const consumersTable = outputForStackWithOutputKey(Stacks[0], 'ConsumersTableName');
  const eventsBucket = outputForStackWithOutputKey(Stacks[0], 'EventsBucketName');

  const ids = {
    partitionsTable,
    consumersTable,
    eventsBucket
  };

  return ids;
}

const changeSetReadyAndWillProduceChanges = async (stackName, changeSetName) => {
  try {
    await cloudformation.waitForAsync('changeSetCreateComplete', {
      StackName: stackName,
      ChangeSetName: changeSetName
    });

    return true;
  } catch (err) {
    const { Status, StatusReason } = await cloudformation.describeChangeSetAsync({
      StackName: stackName,
      ChangeSetName: changeSetName
    });
    if (Status === 'FAILED' && StatusReason === 'The submitted information didn\'t contain changes. Submit different information to create a change set.') {
      // no changes, delete change set
      await cloudformation.deleteChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName
      });

      return false
    }
    throw err;
  }
}

const physicalIdForResourceWithLogicalId = (resources, logicalId) => {
  return _.find(resources, { LogicalResourceId: logicalId }).PhysicalResourceId;
}

const outputForStackWithOutputKey = (stack, outputKey) => {
  return _.find(stack.Outputs, { OutputKey: outputKey }).OutputValue;
}

const stackIsUpdatable = async (stackName) => {
  try {
    const { Stacks } = await cloudformation.describeStacksAsync({
      StackName: stackName
    });

    if (Stacks[0].StackStatus !== 'REVIEW_IN_PROGRESS') {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    if (err.code === 'ValidationError') {
      return false;
    } else {
      throw err;
    }
  }
}

const deployPerfStack = async () => {
  const STACK_NAME = PERF_STACK_NAME;
  const CHANGE_SET_NAME = 'safya-perf-tests-changeset';

  const createTemplate = fs.readFileSync(path.resolve(__dirname, 'perf-stack-create.yml'), 'utf8');
  const updateTemplate = fs.readFileSync(path.resolve(__dirname, 'perf-stack-update.yml'), 'utf8');
  const safyaTemplate = fs.readFileSync(path.resolve(__dirname, path.join('..','src','stack.yml')), 'utf8');

  const shouldUpdateStack = await stackIsUpdatable(STACK_NAME);

  let lambdaPackageKey = `${new Date().toISOString()}/safya-perf-package.zip`;
  let usePreviousLambdaPackage = false;

  if (shouldUpdateStack) {
    const { Stacks } = await cloudformation.describeStacksAsync({
      StackName: STACK_NAME
    });

    const deploymentBucket = _.find(Stacks[0].Outputs, { OutputKey: 'DeploymentBucketName' }).OutputValue;
    const previousLambdaPackageParameter = _.find(Stacks[0].Parameters, { ParameterKey: 'LambdaPackageS3Key' });

    // upload safya stack template to s3 bucket
    await s3.putObjectAsync({
      Bucket: deploymentBucket,
      Key: 'safya-perf-stack.yml',
      Body: safyaTemplate
    });

    // deploy lambda resources
    const packageChanged = await uploadPerfLambda(deploymentBucket, lambdaPackageKey);

    if (!packageChanged && previousLambdaPackageParameter) {
      log.debug('No changes to lambda package, reusing previous deployment package.');
      usePreviousLambdaPackage = true;
    }
  }

  log.debug('creating change set');
  const changeSet = await cloudformation.createChangeSetAsync({
    StackName: STACK_NAME,
    ChangeSetName: CHANGE_SET_NAME,
    ChangeSetType: shouldUpdateStack ? 'UPDATE' : 'CREATE',
    TemplateBody: shouldUpdateStack ? updateTemplate : createTemplate,
    Capabilities: ['CAPABILITY_IAM'],
    Parameters: shouldUpdateStack ? [
      {
        ParameterKey: 'LambdaPackageS3Key',
        ParameterValue: usePreviousLambdaPackage ? undefined : lambdaPackageKey,
        UsePreviousValue: usePreviousLambdaPackage ? true : false
      }
    ] : undefined
  });

  if (await changeSetReadyAndWillProduceChanges(STACK_NAME, CHANGE_SET_NAME)) {
    log.debug('executing change set');
    await cloudformation.executeChangeSetAsync({
      StackName: STACK_NAME,
      ChangeSetName: CHANGE_SET_NAME
    });

    await cloudformation.waitForAsync(shouldUpdateStack ? 'stackUpdateComplete' : 'stackCreateComplete', {
      StackName: STACK_NAME
    });
  } else {
    log.debug('deleting change set');
    await cloudformation.deleteChangeSet({
      StackName: STACK_NAME,
      ChangeSetName: CHANGE_SET_NAME
    });
  }

  if (!shouldUpdateStack) {
    // redeploy to finalise, as on create, we only deploy deployment bucket
    return deployPerfStack();
  } else {
    return perfStackPhysicalIds(STACK_NAME);
  }
}

const describePerfStack = () => {
  return perfStackPhysicalIds(PERF_STACK_NAME);
};

const perfStackPhysicalIds = async (stackName) => {
  const { Stacks } = await cloudformation.describeStacksAsync({
    StackName: stackName
  });

  const deploymentBucket = outputForStackWithOutputKey(Stacks[0], 'DeploymentBucketName');
  const partitionsTable = outputForStackWithOutputKey(Stacks[0], 'PartitionsTableName');
  const consumersTable = outputForStackWithOutputKey(Stacks[0], 'ConsumersTableName');
  const eventsBucket = outputForStackWithOutputKey(Stacks[0], 'EventsBucketName');
  const performanceTestFunction = outputForStackWithOutputKey(Stacks[0], 'PerformanceTestFunctionName');
  return {
    deploymentBucket,
    partitionsTable,
    consumersTable,
    eventsBucket,
    performanceTestFunction
  };
}

const exitWithError = (err) => {
  console.error(err);
  process.exitCode = 1;
}

if (require.main === module) {
  if (process.argv[2] === 'deploy-e2e') {
    deployE2EStack().then(console.log).catch(exitWithError);
  } else if (process.argv[2] === 'deploy-perf') {
    deployPerfStack().then(console.log).catch(exitWithError);
  }
}

module.exports = {
  deployE2EStack,
  deployPerfStack,
  describeE2EStack,
  describePerfStack
};
