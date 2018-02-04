const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const log = require('loglevel');
const { promisifyAll } = require('bluebird');
const uploadTestLambda = require('./test-lambdas/upload');
log.setLevel('debug');

AWS.config.region = 'us-east-1';

const cloudformation = promisifyAll(new AWS.CloudFormation());
const s3 = promisifyAll(new AWS.S3());

const STACK_NAME = 'safya-tests';

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
      log.debug('deleting change set');
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

const deployTestStack = async () => {
  const CHANGE_SET_NAME = 'safya-tests-changeset';

  const createTemplate = fs.readFileSync(path.resolve(__dirname, 'stack-create.yml'), 'utf8');
  const updateTemplate = fs.readFileSync(path.resolve(__dirname, 'stack-update.yml'), 'utf8');
  const safyaTemplate = fs.readFileSync(path.resolve(__dirname, path.join('..','src','stack.yml')), 'utf8');

  const shouldUpdateStack = await stackIsUpdatable(STACK_NAME);

  let lambdaPackageKey = `${new Date().toISOString()}/safya-test-package.zip`;
  let safyaStackKey = `${new Date().toISOString()}/safya-test-stack.yml`;
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
      Key: safyaStackKey,
      Body: safyaTemplate
    });

    // deploy lambda resources
    const packageChanged = await uploadTestLambda(deploymentBucket, lambdaPackageKey);

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
      },
      {
        ParameterKey: 'SafyaStackS3Key',
        ParameterValue: safyaStackKey
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
  }

  if (!shouldUpdateStack) {
    // redeploy to finalise, as on create, we only deploy deployment bucket
    return deployTestStack();
  } else {
    return testStackPhysicalIds(STACK_NAME);
  }
}

const describeTestStack = () => {
  return testStackPhysicalIds(STACK_NAME);
};

const testStackPhysicalIds = async (stackName) => {
  const { Stacks } = await cloudformation.describeStacksAsync({
    StackName: stackName
  });

  const deploymentBucket = outputForStackWithOutputKey(Stacks[0], 'DeploymentBucketName');
  const safyaConfig = outputForStackWithOutputKey(Stacks[0], 'SafyaConfig');
  const producerTestFunction = outputForStackWithOutputKey(Stacks[0], 'ProducerTestFunctionName');
  const consumerTestFunction = outputForStackWithOutputKey(Stacks[0], 'ConsumerTestFunctionName');
  return {
    deploymentBucket,
    safyaConfig,
    producerTestFunction,
    consumerTestFunction
  };
}

const exitWithError = (err) => {
  console.error(err);
  process.exitCode = 1;
}

if (require.main === module) {
  deployTestStack().then(console.log).catch(exitWithError);
}

module.exports = {
  deployTestStack,
  describeTestStack
};
