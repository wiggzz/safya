const AWS = require('aws-sdk');
const fs = require('fs');
const _ = require('lodash');
const { promisifyAll } = require('bluebird');

const cloudformation = promisifyAll(new AWS.CloudFormation());

const STACK_NAME = 'safya-e2e-tests';
const CHANGE_SET_NAME = 'safya-e2e-tests-changeset';

const deploy = async () => {
  const TemplateBody = fs.readFileSync('../src/stack.yml')

  const { Stacks } = await cloudformation.describeStacks({
    StackName: STACK_NAME
  });

  const stackExists = Stacks.length > 0;

  const changeSet = await cloudformation.createChangeSet({
    StackName: STACK_NAME,
    ChangeSetName: CHANGE_SET_NAME,
    ChangeSetType: stackExists ? 'UPDATE' : 'CREATE'
    TemplateBody,
  });

  await cloudformation.waitFor('changeSetCreateComplete', {
    StackName: STACK_NAME,
    ChangeSetName: CHANGE_SET_NAME
  });

  await cloudformation.executeChangeSet({
    StackName: STACK_NAME,
    ChangeSetName: CHANGE_SET_NAME
  });

  await cloudformation.waitFor(stackExists ? 'stackUpdateComplete' : 'stackCreateComplete', {
    StackName: STACK_NAME
  });

  const { StackResources } = await cloudformation.describeStackResources({
    StackName: STACK_NAME
  });

  const partitionsTable = physicalIdForResourceWithLogicalId(StackResources, 'PartitionsTable');
  const consumersTable = physicalIdForResourceWithLogicalId(StackResources, 'ConsumersTable');
  const eventsBucket = physicalIdForResourceWithLogicalId(StackResources, 'EventsBucket');

  return {
    partitionsTable,
    consumersTable,
    eventsBucket
  };
};

const physicalIdForResourceWithLogicalId = (resources, logicalId) => {
  return _.find(resources, logicalId);
}

module.exports = {
  deploy
};
