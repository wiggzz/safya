const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const log = require('loglevel');
const { promisifyAll } = require('bluebird');

AWS.config.region = 'us-east-1';

const cloudformation = promisifyAll(new AWS.CloudFormation());

const STACK_NAME = 'safya-e2e-tests';
const CHANGE_SET_NAME = 'safya-e2e-tests-changeset';

const deploy = async () => {
  const TemplateBody = fs.readFileSync(path.resolve(__dirname, path.join('..','src','stack.yml')), 'utf8');

  const shouldUpdateStack = await stackIsUpdatable(STACK_NAME);

  log.debug('shouldUpdateStack', shouldUpdateStack);

  const changeSet = await cloudformation.createChangeSetAsync({
    StackName: STACK_NAME,
    ChangeSetName: CHANGE_SET_NAME,
    ChangeSetType: shouldUpdateStack ? 'UPDATE' : 'CREATE',
    TemplateBody
  });

  log.debug('changeSet', changeSet);

  try {
    await cloudformation.waitForAsync('changeSetCreateComplete', {
      StackName: STACK_NAME,
      ChangeSetName: CHANGE_SET_NAME
    });
  } catch (err) {
    const { Status, StatusReason } = await cloudformation.describeChangeSetAsync({
      StackName: STACK_NAME,
      ChangeSetName: CHANGE_SET_NAME
    });
    if (Status === 'FAILED' && StatusReason === 'The submitted information didn\'t contain changes. Submit different information to create a change set.') {
      // no changes, we're good.
      return await infraStackPhysicalIds(STACK_NAME);
    }
    throw err;
  }

  log.debug('change set create complete');

  await cloudformation.executeChangeSetAsync({
    StackName: STACK_NAME,
    ChangeSetName: CHANGE_SET_NAME
  });

  await cloudformation.waitForAsync(shouldUpdateStack ? 'stackUpdateComplete' : 'stackCreateComplete', {
    StackName: STACK_NAME
  });

  log.debug('change set execute complete');

  return await infraStackPhysicalIds(STACK_NAME);
};

const infraStackPhysicalIds = async (stackName) => {
  const { StackResources } = await cloudformation.describeStackResourcesAsync({
    StackName: stackName
  });

  log.debug('stack resources', StackResources);

  const partitionsTable = physicalIdForResourceWithLogicalId(StackResources, 'PartitionsTable');
  const consumersTable = physicalIdForResourceWithLogicalId(StackResources, 'ConsumersTable');
  const eventsBucket = physicalIdForResourceWithLogicalId(StackResources, 'EventsBucket');

  const ids = {
    partitionsTable,
    consumersTable,
    eventsBucket
  };

  log.debug('physical ids', ids);

  return ids;
}

const physicalIdForResourceWithLogicalId = (resources, logicalId) => {
  return _.find(resources, { LogicalResourceId: logicalId }).PhysicalResourceId;
}

const stackIsUpdatable = async (stackName) => {
  try {
    const { Stacks } = await cloudformation.describeStacksAsync({
      StackName: STACK_NAME
    });

    log.debug(Stacks);

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

module.exports = {
  deploy
};
