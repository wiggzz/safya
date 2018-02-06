
STACK_NAME="safya-demo"
SAFYA_VERSION="0.2.7"

get_deployment_bucket () {
  DEPLOYMENT_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`DeploymentBucketName`].OutputValue' --output text)
}

get_deployment_bucket

if [ -z $DEPLOYMENT_BUCKET ]; then
  aws cloudformation deploy --stack-name $STACK_NAME --template-file cloudformation-create.yml

  get_deployment_bucket
fi

echo "Packing artifacts and uploading to $DEPLOYMENT_BUCKET"

mkdir -p build

aws cloudformation package \
  --template-file cloudformation-update.yml \
  --s3-bucket $DEPLOYMENT_BUCKET \
  --s3-prefix package \
  --output-template-file build/cloudformation.yml

aws cloudformation deploy \
  --stack-name $STACK_NAME \
  --template-file build/cloudformation.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides SafyaVersion=$SAFYA_VERSION
