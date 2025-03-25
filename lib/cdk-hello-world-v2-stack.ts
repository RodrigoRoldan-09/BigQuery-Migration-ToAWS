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

    // Referencia al S3 bucket existente
    const bucket = s3.Bucket.fromBucketName(this, 'MyBucket', 'rodes-bucket-1909001');

    // Crear una base de datos en Glue
    const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'glue_s3_database'
      }
    });

    // Crear una tabla en Glue asociada a S3
    const glueTable = new glue.CfnTable(this, 'GlueTable', {
      catalogId: this.account,
      databaseName: glueDatabase.ref, //usando ref para obtener el nombre de la DB creada
      tableInput: {
        name: 'glue_s3_table',
        tableType: 'EXTERNAL_TABLE',
        storageDescriptor: {
          columns: [
            { name: 'id', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'value', type: 'double' }
          ],
          location: `s3://${bucket.bucketName}/data/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe'
          }
        }
      }
    });

    // Crear una conexión en Glue
    const glueConnection = new glue.CfnConnection(this, 'GlueConnection', {
      catalogId: this.account,
      connectionInput: {
        name: 's3-glue-connection',
        connectionType: 'NETWORK',
        physicalConnectionRequirements: {
          availabilityZone: 'us-east-1a', 
          securityGroupIdList: ['sg-0fa002e3587b471b3'], 
          subnetId: 'subnet-0087c33f5b89d3d24' 
        }
      }
    }); 

    // IAM Role para Glue
    const glueRole = new iam.Role(this, 'GlueJobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    // Permisos para Glue Job sobre S3
    glueRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [`arn:aws:s3:::rodes-bucket-1909001/*`],
    }));

    glueRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
    }));

    // Glue Job
    const glueJob = new glue.CfnJob(this, 'MyGlueJob', {
      name: 'MyGlueJob',
      role: glueRole.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: `s3://${bucket.bucketName}/cdk-hello-world-v2.py`,
        pythonVersion: '3',
      },
      glueVersion: '3.0',
    });

    // Step Function para ejecutar el Glue Job
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
      stateMachineType: sfn.StateMachineType.EXPRESS,
    });

    definition.addToRolePolicy(new iam.PolicyStatement({
      actions: ['glue:StartJobRun'],
      resources: [`arn:aws:glue:${this.region}:${this.account}:job/${glueJob.ref}`],
    }));

    // EventBridge Rule para ejecutar la Step Function todos los días a las 10 AM UTC
    new events.Rule(this, 'GlueJobSchedule', {
      schedule: events.Schedule.cron({ minute: '0', hour: '10' }),
      targets: [new targets.SfnStateMachine(definition)],
    });
  }
}
