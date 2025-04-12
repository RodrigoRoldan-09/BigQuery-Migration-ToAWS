# BigQuery to AWS Glue Integration (CDK TypeScript)

This project leverages AWS CDK (TypeScript) to deploy an automated architecture that extracts data from Google BigQuery and stores it in Amazon S3 using an AWS Glue Job. The entire process is triggered daily via AWS Step Functions and Amazon EventBridge.

---

## Resources Deployed

This stack provisions and configures the following AWS resources:

1. **Amazon S3 Bucket**
   - Stores the Glue script and JDBC connector.
   - Serves as the destination for the data exported from BigQuery.

2. **Glue ETL Script**
   - A Python script uploaded to the S3 bucket.
   - Executes the data extraction from BigQuery and writes the results in Parquet format to S3.

3. **JDBC Connector**
   - A `.jar` file enabling JDBC connectivity between AWS Glue and Google BigQuery.

4. **VPC (Pre-existing)**
   - The Glue Job runs within an existing VPC for security and network access.

5. **Glue Database and Table**
   - A Glue Data Catalog database and table representing the target schema.

6. **AWS Secrets Manager**
   - Securely stores the GCP service account credentials (JSON format).

7. **IAM Role for Glue**
   - Grants necessary permissions for the Glue Job to access S3, Secrets Manager, CloudWatch Logs, and Glue resources.

8. **Glue Connection (JDBC)**
   - Connects Glue to BigQuery using the JDBC driver and the credentials stored in Secrets Manager.

9. **AWS Glue Job**
   - Executes the ETL script to query data from BigQuery and store it in S3.

10. **AWS Step Function (EXPRESS Type)**
    - Orchestrates the Glue Job execution.

11. **Amazon EventBridge Rule**
    - Triggers the Step Function on a daily schedule (11:15 PM CST).

---

## What Does the ETL Script (`script.py`) Do?

This Python script performs the following steps:

1. Establishes a connection to Google BigQuery via JDBC and AWS Glue.
2. Executes a SQL query (customizable).
3. Converts the result into a DynamicFrame.
4. Writes the data to S3 in compressed **Parquet** format.
5. Updates the Glue Data Catalog with the new metadata.

---

## Prerequisites Before Deployment

Before deploying, you **must update several parameters** in the CDK code to match your environment:

### TypeScript Configuration

#### AWS Account & Region
```ts
env: { account: 'YOUR_AWS_ACCOUNT_ID', region: 'YOUR_AWS_REGION' }
```

#### S3 Bucket Name
```ts
bucketName: 'your-unique-bucket-name'
```

#### Existing VPC ID
```ts
vpcId: 'vpc-xxxxxxxxxxxxxxxxx'
```

#### Glue Database & Table Name
```ts
name: 'your_glue_database_name'
name: 'your_glue_table_name'
```

#### Secret Name in Secrets Manager
```ts
secretName: 'your-secret-name'
```

#### GCP Service Account Credentials (JSON format)
Example contents:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  ...
}
```

#### Glue Job Name
```ts
name: 'your-glue-job-name'
```

---

### Python Script Configuration

#### BigQuery Project, Dataset, and Table
```python
connection_options={"parentProject": "your_project_id", ...}
"query": "SELECT * FROM `your_project.dataset.table`;"
"table": "dataset.table"
```

#### S3 Output Path
```python
path="s3://your-s3-bucket/"
```

#### Glue Catalog Metadata
```python
catalogDatabase="your_database"
catalogTableName="your_table"
```

---

## Deployment Steps

1. Ensure the AWS CLI and CDK are installed and configured.
2. Place the ETL script (`script.py`) in the `script/` directory (it should be there already).
3. Place the JDBC connector `.jar` file (e.g., `GoogleBigQueryJDBC42.jar`) in the `assets/` directory (it also should be there already).
4. Run the following commands:

```bash
cdk bootstrap
cdk deploy
```

---

## Additional Notes

- The S3 bucket is created with `RemovalPolicy.DESTROY` for development purposes. Modify this if persistence is needed in production.
- The Secret created via `Secret.fromSecretNameV2` assumes the secret already has existing parameters configured. Ensure it is correctly configured before deployment.
- The EventBridge rule triggers the Step Function at **11:15 PM CST (05:15 AM UTC)**. You can change this in the CDK code.
- The architecture supports multi-source pipelines and is easily extensible with more Glue Jobs, multiple BQ tables, or other destinations.

---

## Directory Structure

```
project-root/
├── assets/                   # JDBC connector (.jar)
│   └── GoogleBigQueryJDBC42.jar
├── script/                   # Glue ETL script
│   └── script.py
├── lib/
│   └── your-stack.ts         # CDK stack definition
├── bin/
│   └── cdk-app.ts            # CDK entry point
├── cdk.json
├── package.json
└── README.md
```

---