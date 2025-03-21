import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export class CdhelloWorldV2Stack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Reference to your existing S3 bucket
    const bucket = s3.Bucket.fromBucketName(this, 'MyBucket', 'rodes-bucket-1909001');

    // IAM Role for Glue
    const glueRole = new iam.Role(this, 'GlueJobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    // Add permission for Glue job to access the specific S3 object
glueRole.addToPolicy(new iam.PolicyStatement({
  actions: ['s3:GetObject', 's3:PutObject'],
  resources: ['arn:aws:s3:::rodes-bucket-1909001/cdk-hello-world-v2.py'],
}));

glueRole.addToPolicy(new iam.PolicyStatement({
  actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
  resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
}));

    // 🔹 Glue Job
    const glueJob = new glue.CfnJob(this, 'MyGlueJob', {
      name: 'MyGlueJob',
      role: glueRole.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: 's3://rodes-bucket-1909001/cdk-hello-world-v2.py',
        pythonVersion: '3',  // Asegura que usa Python 3
      },
      glueVersion: '3.0',
    });

    // 🔹 Step Function (que ejecuta el Glue Job)
    const startGlueJob = new sfnTasks.CallAwsService(this, 'Start Glue Job', {
      service: 'glue',
      action: 'startJobRun',
      parameters: {
        JobName: glueJob.ref,
      },
      iamResources: [`arn:aws:glue:${this.region}:${this.account}:job/${glueJob.ref}`],
      resultPath: '$.glueJobRunId',
    });

    const definition = new sfn.StateMachine(this, 'GlueJobStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(startGlueJob),
      stateMachineType: sfn.StateMachineType.EXPRESS, // 🔥 Usa Express para cobrar por ejecución
    });

    definition.addToRolePolicy(new iam.PolicyStatement({
      actions: ['glue:StartJobRun'],
      resources: [`arn:aws:glue:${this.region}:${this.account}:job/${glueJob.ref}`],
    }));

    // 🔹 EventBridge Rule (Ejecutar Step Function todos los días a las 10 AM)
    new events.Rule(this, 'GlueJobSchedule', {
      schedule: events.Schedule.cron({ minute: '0', hour: '10' }),
      targets: [new targets.SfnStateMachine(definition)],
    });
  }
}
